from fastapi import FastAPI, APIRouter, HTTPException, Query, Depends, status
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
import bcrypt
import jwt as pyjwt
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

ORDER_STATUSES = ["En préparation", "Prête"]
ADMIN_STATUS_CHOICES = ["En préparation", "Prête", "Récupérée", "Annulée"]


def compute_status(created_at_iso: str) -> str:
    try:
        dt = datetime.fromisoformat(created_at_iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        elapsed_sec = (datetime.now(timezone.utc) - dt).total_seconds()
    except Exception:
        return ORDER_STATUSES[0]
    if elapsed_sec < 300:  # < 5 min
        return ORDER_STATUSES[0]
    return ORDER_STATUSES[1]


def with_status(order_doc: dict) -> dict:
    manual = order_doc.get("manual_status")
    if manual:
        order_doc["status"] = manual
    else:
        order_doc["status"] = compute_status(order_doc.get("created_at", ""))
    return order_doc

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ---------------------- Models ----------------------
class Category(BaseModel):
    id: str
    name: str
    icon: str  # ionicons name
    image: str
    kind: str  # "restaurant" | "grocery"


class WeightVariant(BaseModel):
    label: str  # "1 g", "5 g", "10 g"…
    price: float


class Product(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str
    price: float  # base price (kept for legacy; falls back to lowest variant)
    image: str
    category_id: str
    category_kind: str
    unit: Optional[str] = None
    popular: bool = False
    promo: bool = False
    variants: List[WeightVariant] = []


def min_variant_price(product: dict) -> float:
    variants = product.get("variants") or []
    if not variants:
        return float(product.get("price", 0))
    return min(float(v["price"]) for v in variants)


def find_variant(product: dict, label: str) -> Optional[dict]:
    for v in product.get("variants") or []:
        if v.get("label") == label:
            return v
    return None


class CartItemIn(BaseModel):
    product_id: str
    quantity: int
    variant_label: Optional[str] = None


class OrderIn(BaseModel):
    guest_id: str
    customer_name: str
    address: str
    phone: str
    notes: Optional[str] = ""
    items: List[CartItemIn]
    use_points: float = 0.0


class OrderItem(BaseModel):
    product_id: str
    name: str
    price: float
    image: str
    quantity: int
    variant_label: Optional[str] = None


class Order(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    guest_id: str
    customer_name: str
    address: str
    phone: str
    notes: str = ""
    items: List[OrderItem]
    subtotal: float
    delivery_fee: float = 0.0
    points_used: float = 0.0
    points_earned: float = 0.0
    total: float
    status: str = "En préparation"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Loyalty(BaseModel):
    guest_id: str
    points_balance: float = 0.0
    total_earned: float = 0.0
    total_spent: float = 0.0
    orders_count: int = 0


# ---------------------- Seed Data ----------------------
CATEGORIES: List[Category] = [
    Category(id="fleurs", name="Fleurs CBD", icon="leaf", kind="cbd",
             image="https://images.unsplash.com/photo-1603909223429-69bb7101f420"),
    Category(id="resines", name="Résines & Pollens", icon="cube", kind="cbd",
             image="https://images.unsplash.com/photo-1603909223429-69bb7101f420"),
    Category(id="huiles", name="Huiles CBD", icon="water", kind="cbd",
             image="https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5"),
    Category(id="eliquides", name="E-liquides", icon="cloud", kind="cbd",
             image="https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5"),
    Category(id="infusions", name="Infusions & Confiserie", icon="cafe", kind="cbd",
             image="https://images.unsplash.com/photo-1546793665-c74683f339c1"),
    Category(id="cosmetiques", name="Cosmétiques", icon="sparkles", kind="cbd",
             image="https://images.unsplash.com/photo-1571212515416-fef01fc43637"),
    Category(id="animaux", name="Animaux", icon="paw", kind="cbd",
             image="https://images.unsplash.com/photo-1628088062854-d1870b4553da"),
    Category(id="accessoires", name="Accessoires", icon="construct", kind="cbd",
             image="https://images.unsplash.com/photo-1542838132-92c53300491e"),
]

# All products contain < 0,3 % THC, conformément à la réglementation française.
PRODUCTS: List[Product] = [
    # --- Fleurs CBD ---
    Product(name="Strawberry Haze Indoor", description="Sativa fruitée aux notes de fraise. Culture indoor sous LED. 18 % CBD · < 0,2 % THC.",
            price=9.00, unit="1 g", image="https://images.unsplash.com/photo-1603909223429-69bb7101f420",
            category_id="fleurs", category_kind="cbd", popular=True),
    Product(name="Amnesia Haze Greenhouse", description="Variété classique aux arômes citronnés et terreux. 14 % CBD · < 0,2 % THC.",
            price=7.00, unit="1 g", image="https://images.unsplash.com/photo-1603909223429-69bb7101f420",
            category_id="fleurs", category_kind="cbd", popular=True),
    Product(name="OG Kush Indoor", description="Indica relaxante, notes de pin et de terre. 19 % CBD · < 0,2 % THC.",
            price=9.50, unit="1 g", image="https://images.unsplash.com/photo-1603909223429-69bb7101f420",
            category_id="fleurs", category_kind="cbd"),
    Product(name="Gorilla Glue Indoor", description="Hybride puissante, terpènes boisés et résineux. 17 % CBD · < 0,2 % THC.",
            price=9.00, unit="1 g", image="https://images.unsplash.com/photo-1603909223429-69bb7101f420",
            category_id="fleurs", category_kind="cbd", promo=True),
    Product(name="Purple Haze Outdoor", description="Plein air, notes de fruits rouges et de raisin. 12 % CBD · < 0,2 % THC.",
            price=6.00, unit="1 g", image="https://images.unsplash.com/photo-1603909223429-69bb7101f420",
            category_id="fleurs", category_kind="cbd"),
    Product(name="Lemon Haze Greenhouse", description="Sativa pétillante aux arômes d'agrumes frais. 15 % CBD · < 0,2 % THC.",
            price=7.50, unit="1 g", image="https://images.unsplash.com/photo-1603909223429-69bb7101f420",
            category_id="fleurs", category_kind="cbd"),
    Product(name="Critical Mass Outdoor", description="Indica douce et relaxante, dense et terreuse. 13 % CBD · < 0,2 % THC.",
            price=6.00, unit="1 g", image="https://images.unsplash.com/photo-1603909223429-69bb7101f420",
            category_id="fleurs", category_kind="cbd", promo=True),
    Product(name="White Widow Indoor", description="Hybride iconique aux notes florales et poivrées. 18 % CBD · < 0,2 % THC.",
            price=9.00, unit="1 g", image="https://images.unsplash.com/photo-1603909223429-69bb7101f420",
            category_id="fleurs", category_kind="cbd", popular=True),

    # --- Résines & Pollens ---
    Product(name="Charas Hindou Kush", description="Résine artisanale roulée main, texture souple, arôme épicé. 22 % CBD · < 0,2 % THC.",
            price=10.00, unit="1 g", image="https://images.unsplash.com/photo-1603909223429-69bb7101f420",
            category_id="resines", category_kind="cbd", popular=True),
    Product(name="Afghan Hash", description="Résine traditionnelle afghane, douce et terreuse. 20 % CBD · < 0,2 % THC.",
            price=8.00, unit="1 g", image="https://images.unsplash.com/photo-1603909223429-69bb7101f420",
            category_id="resines", category_kind="cbd"),
    Product(name="Pollen Gold", description="Pollen pressé blond, arômes herbacés délicats. 18 % CBD · < 0,2 % THC.",
            price=7.00, unit="1 g", image="https://images.unsplash.com/photo-1603909223429-69bb7101f420",
            category_id="resines", category_kind="cbd"),

    # --- Huiles CBD ---
    Product(name="Huile CBD 5 % Full Spectrum", description="Huile sublinguale full spectrum, base MCT coco. 500 mg CBD · flacon 10 ml.",
            price=24.90, unit="10 ml", image="https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5",
            category_id="huiles", category_kind="cbd", popular=True),
    Product(name="Huile CBD 10 % Full Spectrum", description="Spectre complet, terpènes naturels, base MCT. 1000 mg CBD · 10 ml.",
            price=39.90, unit="10 ml", image="https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5",
            category_id="huiles", category_kind="cbd", popular=True),
    Product(name="Huile CBD 20 % Broad Spectrum", description="Sans THC détectable, idéale pour usage quotidien. 2000 mg CBD · 10 ml.",
            price=69.90, unit="10 ml", image="https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5",
            category_id="huiles", category_kind="cbd"),
    Product(name="Huile CBD 30 % Isolat", description="Isolat de CBD pur cristallisé, base huile de chanvre. 3000 mg CBD · 10 ml.",
            price=89.90, unit="10 ml", image="https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5",
            category_id="huiles", category_kind="cbd", promo=True),

    # --- E-liquides ---
    Product(name="E-liquide Fraise CBD 300 mg", description="Saveur fraise gourmande, ratio 50/50 PG/VG. 10 ml.",
            price=19.90, unit="10 ml", image="https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5",
            category_id="eliquides", category_kind="cbd"),
    Product(name="E-liquide Menthe Glaciale 500 mg", description="Fraîcheur intense, sans nicotine. 10 ml.",
            price=24.90, unit="10 ml", image="https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5",
            category_id="eliquides", category_kind="cbd", popular=True),
    Product(name="E-liquide Fruits Rouges 1000 mg", description="Mix fraise/framboise/cassis, dosage puissant. 10 ml.",
            price=39.90, unit="10 ml", image="https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5",
            category_id="eliquides", category_kind="cbd"),

    # --- Infusions & Confiserie ---
    Product(name="Tisane Relaxation CBD", description="Mélange chanvre, camomille et tilleul. 20 sachets dosés à 15 mg CBD.",
            price=12.90, unit="x20", image="https://images.unsplash.com/photo-1546793665-c74683f339c1",
            category_id="infusions", category_kind="cbd", popular=True),
    Product(name="Tisane Sommeil CBD", description="Chanvre, mélisse, valériane, verveine. 20 sachets à 20 mg CBD.",
            price=14.90, unit="x20", image="https://images.unsplash.com/photo-1546793665-c74683f339c1",
            category_id="infusions", category_kind="cbd"),
    Product(name="Gummies CBD 25 mg", description="Bonbons gélifiés aux fruits, vegan, sans gluten. Boîte de 20.",
            price=19.90, unit="x20", image="https://images.unsplash.com/photo-1546793665-c74683f339c1",
            category_id="infusions", category_kind="cbd", promo=True),
    Product(name="Chocolat Noir CBD 50 mg", description="Chocolat noir 70 %, infusé au CBD. Tablette 80 g.",
            price=14.90, unit="80 g", image="https://images.unsplash.com/photo-1546793665-c74683f339c1",
            category_id="infusions", category_kind="cbd"),

    # --- Cosmétiques ---
    Product(name="Crème Massage CBD 250 mg", description="Crème apaisante au CBD et arnica. Tube 100 ml.",
            price=24.90, unit="100 ml", image="https://images.unsplash.com/photo-1571212515416-fef01fc43637",
            category_id="cosmetiques", category_kind="cbd", popular=True),
    Product(name="Baume Articulations 500 mg", description="Baume concentré CBD + menthol + eucalyptus. Pot 50 ml.",
            price=29.90, unit="50 ml", image="https://images.unsplash.com/photo-1571212515416-fef01fc43637",
            category_id="cosmetiques", category_kind="cbd"),

    # --- Animaux ---
    Product(name="Huile CBD 5 % Animaux", description="Spécialement formulée pour chien et chat. Saveur naturelle. 10 ml.",
            price=24.90, unit="10 ml", image="https://images.unsplash.com/photo-1628088062854-d1870b4553da",
            category_id="animaux", category_kind="cbd", popular=True),
    Product(name="Friandises Chien CBD 25 mg", description="Friandises au saumon, sans céréales. Sachet de 30.",
            price=19.90, unit="x30", image="https://images.unsplash.com/photo-1628088062854-d1870b4553da",
            category_id="animaux", category_kind="cbd"),

    # --- Accessoires ---
    Product(name="Grinder Métal 4 Parts", description="Grinder aluminium anodisé 50 mm, 4 compartiments, tamis pollen.",
            price=14.90, unit="pièce", image="https://images.unsplash.com/photo-1542838132-92c53300491e",
            category_id="accessoires", category_kind="cbd"),
    Product(name="Vaporisateur Portable", description="Vaporisateur à convection, idéal pour fleurs et résines. Garantie 2 ans.",
            price=79.90, unit="pièce", image="https://images.unsplash.com/photo-1542838132-92c53300491e",
            category_id="accessoires", category_kind="cbd", promo=True),
    Product(name="Boîte de Conservation", description="Boîte hermétique en verre opaque, préserve les terpènes. 100 ml.",
            price=9.90, unit="100 ml", image="https://images.unsplash.com/photo-1542838132-92c53300491e",
            category_id="accessoires", category_kind="cbd"),
]


@app.on_event("startup")
async def seed_database():
    # Force reseed of catalog so the new CBD products replace the legacy ones.
    # We use a `meta` doc with a seed version to avoid wiping on every restart.
    SEED_VERSION = "cbd-v2"
    meta = await db.meta.find_one({"_id": "catalog_seed"})
    if not meta or meta.get("version") != SEED_VERSION:
        await db.categories.delete_many({})
        await db.products.delete_many({})
        await db.categories.insert_many([c.dict() for c in CATEGORIES])
        await db.products.insert_many([p.dict() for p in PRODUCTS])
        await db.meta.update_one(
            {"_id": "catalog_seed"},
            {"$set": {"version": SEED_VERSION}},
            upsert=True,
        )


# ---------------------- Routes ----------------------
@api_router.get("/")
async def root():
    return {"message": "Ordering API up"}


@api_router.get("/categories", response_model=List[Category])
async def list_categories():
    items = await db.categories.find({}, {"_id": 0}).to_list(100)
    return items


@api_router.get("/products", response_model=List[Product])
async def list_products(
    category_id: Optional[str] = None,
    kind: Optional[str] = None,
    search: Optional[str] = None,
    popular: Optional[bool] = None,
    promo: Optional[bool] = None,
):
    query: dict = {}
    if category_id:
        query["category_id"] = category_id
    if kind:
        query["category_kind"] = kind
    if popular is not None:
        query["popular"] = popular
    if promo is not None:
        query["promo"] = promo
    if search:
        query["name"] = {"$regex": search, "$options": "i"}
    items = await db.products.find(query, {"_id": 0}).to_list(500)
    return items


@api_router.get("/products/{product_id}", response_model=Product)
async def get_product(product_id: str):
    item = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    return item


@api_router.post("/orders", response_model=Order)
async def create_order(payload: OrderIn):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Le panier est vide")

    product_ids = [i.product_id for i in payload.items]
    products = await db.products.find({"id": {"$in": product_ids}}, {"_id": 0}).to_list(500)
    product_map = {p["id"]: p for p in products}

    order_items: List[OrderItem] = []
    subtotal = 0.0
    for it in payload.items:
        p = product_map.get(it.product_id)
        if not p:
            raise HTTPException(status_code=400, detail=f"Produit {it.product_id} introuvable")
        # Resolve variant price
        unit_price = float(p.get("price", 0))
        variant_label = it.variant_label
        if variant_label:
            v = find_variant(p, variant_label)
            if not v:
                raise HTTPException(status_code=400, detail=f"Variante '{variant_label}' introuvable pour {p['name']}")
            unit_price = float(v["price"])
        elif p.get("variants"):
            # No variant specified — fall back to cheapest variant
            v = min(p["variants"], key=lambda x: float(x["price"]))
            unit_price = float(v["price"])
            variant_label = v["label"]

        line_total = unit_price * it.quantity
        subtotal += line_total
        order_items.append(OrderItem(
            product_id=p["id"], name=p["name"], price=unit_price,
            image=p["image"], quantity=it.quantity,
            variant_label=variant_label,
        ))

    loyalty_doc = await db.loyalty.find_one({"guest_id": payload.guest_id}, {"_id": 0})
    current_balance = float(loyalty_doc["points_balance"]) if loyalty_doc else 0.0
    use_points = max(0.0, min(float(payload.use_points or 0.0), current_balance, subtotal))
    use_points = round(use_points, 2)

    discounted_subtotal = max(0.0, subtotal - use_points)
    total = round(discounted_subtotal, 2)
    points_earned = round(int(discounted_subtotal // 10) * 1.0, 2)

    order = Order(
        guest_id=payload.guest_id,
        customer_name=payload.customer_name,
        address=payload.address,
        phone=payload.phone,
        notes=payload.notes or "",
        items=order_items,
        subtotal=round(subtotal, 2),
        delivery_fee=0.0,
        points_used=use_points,
        points_earned=points_earned,
        total=total,
    )
    await db.orders.insert_one(order.dict())

    new_balance = round(current_balance - use_points + points_earned, 2)
    await db.loyalty.update_one(
        {"guest_id": payload.guest_id},
        {
            "$set": {"guest_id": payload.guest_id, "points_balance": new_balance},
            "$inc": {
                "total_earned": points_earned,
                "total_spent": use_points,
                "orders_count": 1,
            },
        },
        upsert=True,
    )
    return order


@api_router.get("/loyalty/{guest_id}", response_model=Loyalty)
async def get_loyalty(guest_id: str):
    doc = await db.loyalty.find_one({"guest_id": guest_id}, {"_id": 0})
    if not doc:
        return Loyalty(guest_id=guest_id)
    return Loyalty(**doc)


@api_router.get("/orders", response_model=List[Order])
async def list_orders(guest_id: str = Query(...)):
    items = await db.orders.find({"guest_id": guest_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [with_status(o) for o in items]


@api_router.get("/orders/{order_id}", response_model=Order)
async def get_order(order_id: str):
    item = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    return with_status(item)


# ====================================================================
# ADMIN AUTH + CRUD
# ====================================================================

JWT_SECRET = os.environ.get("JWT_SECRET_KEY", "change-me")
JWT_ALGO = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_HOURS = int(os.environ.get("JWT_EXPIRE_HOURS", "24"))
LOCKOUT_THRESHOLD = int(os.environ.get("ADMIN_LOCKOUT_THRESHOLD", "5"))
LOCKOUT_MINUTES = int(os.environ.get("ADMIN_LOCKOUT_MINUTES", "15"))

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/admin/login", auto_error=True)


def _hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_pin(pin: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pin.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _make_token() -> tuple[str, int]:
    exp = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = {"sub": "admin", "exp": exp, "iat": datetime.now(timezone.utc)}
    token = pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)
    return token, JWT_EXPIRE_HOURS


async def require_admin(token: str = Depends(oauth2_scheme)) -> dict:
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expirée")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Jeton invalide")
    if payload.get("sub") != "admin":
        raise HTTPException(status_code=401, detail="Accès refusé")
    return payload


class AdminLoginIn(BaseModel):
    pin: str = Field(min_length=4, max_length=8)


class AdminChangePinIn(BaseModel):
    current_pin: str = Field(min_length=4, max_length=8)
    new_pin: str = Field(min_length=4, max_length=8)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_hours: int


@app.on_event("startup")
async def migrate_variants():
    """One-shot migration: ensure each product has weight variants.
    Defaults depend on the product category."""
    DEFAULT_VARIANTS = {
        "fleurs": [
            {"label": "1 g", "price": 9.0},
            {"label": "5 g", "price": 40.0},
            {"label": "10 g", "price": 75.0},
            {"label": "25 g", "price": 175.0},
            {"label": "50 g", "price": 320.0},
        ],
        "resines": [
            {"label": "1 g", "price": 10.0},
            {"label": "5 g", "price": 45.0},
            {"label": "10 g", "price": 85.0},
            {"label": "25 g", "price": 200.0},
        ],
    }
    GENERIC = [{"label": "1 pièce", "price": 0.0}]
    cursor = db.products.find({"$or": [{"variants": {"$exists": False}}, {"variants": {"$size": 0}}]}, {"_id": 0})
    async for prod in cursor:
        base_price = float(prod.get("price", 0))
        defaults = DEFAULT_VARIANTS.get(prod.get("category_id"))
        if defaults:
            variants = [dict(v) for v in defaults]
        else:
            variants = [{"label": prod.get("unit") or "1 pièce", "price": base_price or 9.9}]
        await db.products.update_one({"id": prod["id"]}, {"$set": {"variants": variants}})
    existing = await db.admin_config.find_one({"_id": "admin"})
    if existing is None:
        initial = os.environ.get("ADMIN_INITIAL_PIN")
        if not initial:
            return
        now = datetime.now(timezone.utc).isoformat()
        await db.admin_config.insert_one(
            {
                "_id": "admin",
                "pin_hash": _hash_pin(initial),
                "failed_attempts": 0,
                "lockout_until": None,
                "created_at": now,
                "updated_at": now,
            }
        )


@api_router.post("/admin/login", response_model=TokenOut)
async def admin_login(body: AdminLoginIn):
    doc = await db.admin_config.find_one({"_id": "admin"})
    if doc is None:
        raise HTTPException(status_code=500, detail="Administrateur non configuré")
    now = datetime.now(timezone.utc)
    lockout = doc.get("lockout_until")
    if lockout:
        try:
            lockout_dt = datetime.fromisoformat(lockout) if isinstance(lockout, str) else lockout
            if lockout_dt.tzinfo is None:
                lockout_dt = lockout_dt.replace(tzinfo=timezone.utc)
            if lockout_dt > now:
                raise HTTPException(
                    status_code=429,
                    detail="Trop de tentatives. Réessayez plus tard.",
                )
        except HTTPException:
            raise
        except Exception:
            pass

    if not _verify_pin(body.pin, doc["pin_hash"]):
        attempts = int(doc.get("failed_attempts", 0)) + 1
        update = {"failed_attempts": attempts, "updated_at": now.isoformat()}
        if attempts >= LOCKOUT_THRESHOLD:
            update["lockout_until"] = (now + timedelta(minutes=LOCKOUT_MINUTES)).isoformat()
        await db.admin_config.update_one({"_id": "admin"}, {"$set": update})
        raise HTTPException(status_code=401, detail="PIN invalide")

    await db.admin_config.update_one(
        {"_id": "admin"},
        {"$set": {"failed_attempts": 0, "lockout_until": None, "updated_at": now.isoformat()}},
    )
    token, hours = _make_token()
    return TokenOut(access_token=token, expires_hours=hours)


@api_router.post("/admin/change-pin")
async def admin_change_pin(body: AdminChangePinIn, _admin: dict = Depends(require_admin)):
    doc = await db.admin_config.find_one({"_id": "admin"})
    if doc is None:
        raise HTTPException(status_code=500, detail="Administrateur non configuré")
    if not _verify_pin(body.current_pin, doc["pin_hash"]):
        raise HTTPException(status_code=401, detail="PIN actuel incorrect")
    now = datetime.now(timezone.utc).isoformat()
    await db.admin_config.update_one(
        {"_id": "admin"},
        {"$set": {"pin_hash": _hash_pin(body.new_pin), "updated_at": now,
                  "failed_attempts": 0, "lockout_until": None}},
    )
    return {"status": "ok"}


# ---------------- Admin CRUD: Products ----------------

class ProductIn(BaseModel):
    name: str
    description: str
    price: float = 0
    image: str
    category_id: str
    category_kind: str = "cbd"
    unit: Optional[str] = None
    popular: bool = False
    promo: bool = False
    variants: List[WeightVariant] = []


class ProductPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    image: Optional[str] = None
    category_id: Optional[str] = None
    category_kind: Optional[str] = None
    unit: Optional[str] = None
    popular: Optional[bool] = None
    promo: Optional[bool] = None
    variants: Optional[List[WeightVariant]] = None


@api_router.post("/admin/products", response_model=Product)
async def admin_create_product(payload: ProductIn, _admin: dict = Depends(require_admin)):
    product = Product(**payload.dict())
    await db.products.insert_one(product.dict())
    return product


@api_router.patch("/admin/products/{product_id}", response_model=Product)
async def admin_update_product(product_id: str, payload: ProductPatch, _admin: dict = Depends(require_admin)):
    update = {k: v for k, v in payload.dict(exclude_unset=True).items()}
    if not update:
        raise HTTPException(status_code=400, detail="Aucun champ à mettre à jour")
    result = await db.products.update_one({"id": product_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    updated = await db.products.find_one({"id": product_id}, {"_id": 0})
    return updated


@api_router.delete("/admin/products/{product_id}")
async def admin_delete_product(product_id: str, _admin: dict = Depends(require_admin)):
    result = await db.products.delete_one({"id": product_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    return {"status": "ok"}


# ---------------- Admin CRUD: Categories ----------------

class CategoryIn(BaseModel):
    id: str
    name: str
    icon: str = "leaf"
    image: str
    kind: str = "cbd"


class CategoryPatch(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    image: Optional[str] = None
    kind: Optional[str] = None


@api_router.post("/admin/categories", response_model=Category)
async def admin_create_category(payload: CategoryIn, _admin: dict = Depends(require_admin)):
    existing = await db.categories.find_one({"id": payload.id})
    if existing:
        raise HTTPException(status_code=400, detail="Identifiant de catégorie déjà utilisé")
    cat = Category(**payload.dict())
    await db.categories.insert_one(cat.dict())
    return cat


@api_router.patch("/admin/categories/{category_id}", response_model=Category)
async def admin_update_category(category_id: str, payload: CategoryPatch, _admin: dict = Depends(require_admin)):
    update = {k: v for k, v in payload.dict(exclude_unset=True).items()}
    if not update:
        raise HTTPException(status_code=400, detail="Aucun champ à mettre à jour")
    result = await db.categories.update_one({"id": category_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    updated = await db.categories.find_one({"id": category_id}, {"_id": 0})
    return updated


@api_router.delete("/admin/categories/{category_id}")
async def admin_delete_category(category_id: str, _admin: dict = Depends(require_admin)):
    in_use = await db.products.count_documents({"category_id": category_id})
    if in_use > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cette catégorie est utilisée par {in_use} produit(s). Supprimez d'abord les produits.",
        )
    result = await db.categories.delete_one({"id": category_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    return {"status": "ok"}


# ---------------- Admin: Orders ----------------

class OrderStatusUpdate(BaseModel):
    status: str


@api_router.get("/admin/orders", response_model=List[Order])
async def admin_list_orders(_admin: dict = Depends(require_admin)):
    items = await db.orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [with_status(o) for o in items]


@api_router.patch("/admin/orders/{order_id}", response_model=Order)
async def admin_update_order(order_id: str, payload: OrderStatusUpdate, _admin: dict = Depends(require_admin)):
    if payload.status not in ADMIN_STATUS_CHOICES:
        raise HTTPException(status_code=400, detail=f"Statut invalide. Choix : {', '.join(ADMIN_STATUS_CHOICES)}")
    result = await db.orders.update_one(
        {"id": order_id},
        {"$set": {"manual_status": payload.status}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return with_status(updated)


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

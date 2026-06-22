from fastapi import FastAPI, APIRouter, HTTPException, Query, Depends, status, Request
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import secrets
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
import bcrypt
import httpx
import html as html_lib
import jwt as pyjwt
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

ORDER_STATUSES = ["En cours", "Terminée"]
ADMIN_STATUS_CHOICES = ["En cours", "Terminée", "Annulée"]
DEFAULT_LOW_STOCK_THRESHOLD = 5


def compute_status(created_at_iso: str) -> str:
    # No auto-advance: stays "En cours" until admin marks it
    return ORDER_STATUSES[0]


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
    stock: Optional[int] = None  # None = unlimited; otherwise current available units
    low_stock_threshold: Optional[int] = None  # None → use DEFAULT_LOW_STOCK_THRESHOLD


class PromoCode(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    code: str  # uppercase, unique
    kind: str  # "percent" | "amount" | "amount_min"
    value: float  # percent (1-100) or euro amount
    min_subtotal: float = 0.0  # only for "amount_min"
    max_uses: Optional[int] = None  # null = unlimited
    times_used: int = 0
    expires_at: Optional[str] = None  # ISO
    enabled: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


def evaluate_promo(promo: dict, subtotal: float) -> tuple[float, Optional[str]]:
    """Return (discount_amount, error_message). discount_amount = 0 if invalid."""
    if not promo.get("enabled", True):
        return 0.0, "Code désactivé."
    exp = promo.get("expires_at")
    if exp:
        try:
            dt = datetime.fromisoformat(exp)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt < datetime.now(timezone.utc):
                return 0.0, "Code expiré."
        except Exception:
            pass
    max_uses = promo.get("max_uses")
    if max_uses is not None and int(promo.get("times_used", 0)) >= int(max_uses):
        return 0.0, "Code épuisé."
    kind = promo.get("kind")
    value = float(promo.get("value", 0))
    if kind == "percent":
        d = round(subtotal * (value / 100.0), 2)
        return min(d, subtotal), None
    if kind == "amount" or kind == "fixed":
        return round(min(value, subtotal), 2), None
    if kind == "amount_min":
        ms = float(promo.get("min_subtotal", 0))
        if subtotal < ms:
            need = round(ms - subtotal, 2)
            return 0.0, f"Ajoutez {need:.2f} €".replace(".", ",") + f" pour utiliser ce code (min {ms:.0f} €)."
        return round(min(value, subtotal), 2), None
    return 0.0, "Type de code inconnu."


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


# ---------------- Customer (Telegram-linked) user model ----------------

class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    telegram_user_id: int
    telegram_username: Optional[str] = None
    name: str = ""
    phone: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    last_login_at: Optional[str] = None


USER_JWT_SECRET = os.getenv("USER_JWT_SECRET", os.getenv("JWT_SECRET", "change-me-cave420-user"))
USER_JWT_ALG = "HS256"
USER_JWT_EXP_DAYS = 90


def issue_user_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "scope": "user",
        "iat": int(datetime.now(timezone.utc).timestamp()),
        "exp": int((datetime.now(timezone.utc) + timedelta(days=USER_JWT_EXP_DAYS)).timestamp()),
    }
    return pyjwt.encode(payload, USER_JWT_SECRET, algorithm=USER_JWT_ALG)


def decode_user_token(token: str) -> Optional[str]:
    try:
        payload = pyjwt.decode(token, USER_JWT_SECRET, algorithms=[USER_JWT_ALG])
        if payload.get("scope") != "user":
            return None
        return payload.get("sub")
    except Exception:
        return None


async def get_current_user_optional(request: Request) -> Optional[dict]:
    auth = request.headers.get("Authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None
    token = auth.split(" ", 1)[1].strip()
    user_id = decode_user_token(token)
    if not user_id:
        return None
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    return user


class OrderIn(BaseModel):
    guest_id: str
    customer_name: str
    address: str = ""
    phone: str = ""
    customer_email: Optional[str] = ""
    notes: Optional[str] = ""
    delivery_mode: str = "delivery"  # "delivery" | "pickup"
    items: List[CartItemIn]
    promo_code: Optional[str] = None
    # Kept for backward compat but ignored:
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
    user_id: Optional[str] = None
    customer_name: str
    address: str
    phone: str
    customer_email: str = ""
    notes: str = ""
    delivery_mode: str = "delivery"  # "delivery" | "pickup"
    items: List[OrderItem]
    subtotal: float
    delivery_fee: float = 0.0
    promo_code: Optional[str] = None
    discount_amount: float = 0.0
    # Legacy fields kept so old orders still parse:
    points_used: float = 0.0
    points_earned: float = 0.0
    total: float
    status: str = "En cours"
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
async def create_order(payload: OrderIn, request: Request):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Le panier est vide")

    # Optionally attach to an authenticated customer
    current_user = await get_current_user_optional(request)

    delivery_mode = (payload.delivery_mode or "delivery").strip().lower()
    if delivery_mode not in ("delivery", "pickup"):
        delivery_mode = "delivery"
    if delivery_mode == "delivery" and not payload.address.strip():
        raise HTTPException(status_code=400, detail="Adresse de livraison requise")

    product_ids = [i.product_id for i in payload.items]
    products = await db.products.find({"id": {"$in": product_ids}}, {"_id": 0}).to_list(500)
    product_map = {p["id"]: p for p in products}

    # First pass: aggregate requested quantities per (product, variant) to check stock
    req_map: dict[tuple[str, Optional[str]], int] = {}
    for it in payload.items:
        key = (it.product_id, it.variant_label or None)
        req_map[key] = req_map.get(key, 0) + max(1, int(it.quantity))
    # Validate stock availability
    for (pid, label), qty in req_map.items():
        p = product_map.get(pid)
        if not p:
            continue
        if not label:
            continue
        v = find_variant(p, label)
        if not v:
            continue
        stock = v.get("stock")
        if stock is None:
            continue  # unlimited
        if int(stock) <= 0:
            raise HTTPException(status_code=409, detail=f"« {p['name']} ({label}) » est en rupture de stock.")
        if int(stock) < qty:
            raise HTTPException(
                status_code=409,
                detail=f"Stock insuffisant pour « {p['name']} ({label}) » : plus que {int(stock)} disponible{'s' if int(stock) > 1 else ''}.",
            )

    order_items: List[OrderItem] = []
    subtotal = 0.0
    for it in payload.items:
        p = product_map.get(it.product_id)
        if not p:
            raise HTTPException(status_code=400, detail=f"Produit {it.product_id} introuvable")
        unit_price = float(p.get("price", 0))
        variant_label = it.variant_label
        if variant_label:
            v = find_variant(p, variant_label)
            if not v:
                raise HTTPException(status_code=400, detail=f"Variante '{variant_label}' introuvable pour {p['name']}")
            unit_price = float(v["price"])
        elif p.get("variants"):
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

    # Promo code application
    promo_code_applied: Optional[str] = None
    discount = 0.0
    if payload.promo_code:
        code = payload.promo_code.strip().upper()
        promo = await db.promo_codes.find_one({"code": code}, {"_id": 0})
        if promo:
            d, err = evaluate_promo(promo, subtotal)
            if err is None and d > 0:
                discount = d
                promo_code_applied = code
                await db.promo_codes.update_one({"code": code}, {"$inc": {"times_used": 1}})

    total = round(max(0.0, subtotal - discount), 2)

    order = Order(
        guest_id=payload.guest_id,
        user_id=(current_user["id"] if current_user else None),
        customer_name=payload.customer_name,
        address=payload.address.strip() if delivery_mode == "delivery" else "",
        phone=payload.phone,
        customer_email=(payload.customer_email or "").strip().lower(),
        notes=payload.notes or "",
        delivery_mode=delivery_mode,
        items=order_items,
        subtotal=round(subtotal, 2),
        delivery_fee=0.0,
        promo_code=promo_code_applied,
        discount_amount=round(discount, 2),
        total=total,
    )
    await db.orders.insert_one(order.dict())

    # Decrement stock for tracked variants and collect low-stock warnings
    low_stock_alerts: list[dict] = []
    for (pid, label), qty in req_map.items():
        if not label:
            continue
        product = await db.products.find_one({"id": pid}, {"_id": 0})
        if not product:
            continue
        variants = list(product.get("variants") or [])
        changed = False
        for v in variants:
            if v.get("label") == label and v.get("stock") is not None:
                before = int(v["stock"])
                after = max(0, before - qty)
                v["stock"] = after
                changed = True
                thr = v.get("low_stock_threshold")
                if thr is None:
                    thr = DEFAULT_LOW_STOCK_THRESHOLD
                # Trigger alert if we crossed the threshold or are at zero
                if after <= int(thr) and before > int(thr) or (after == 0 and before > 0):
                    low_stock_alerts.append({
                        "name": product.get("name"),
                        "label": label,
                        "remaining": after,
                        "out_of_stock": after == 0,
                    })
                break
        if changed:
            await db.products.update_one({"id": pid}, {"$set": {"variants": variants}})

    try:
        await send_telegram_order_notification(order)
    except Exception as e:
        logger.warning("[telegram] outer error: %s", e)

    if low_stock_alerts:
        try:
            await send_low_stock_alert(low_stock_alerts)
        except Exception as e:
            logger.warning("[telegram] low-stock alert error: %s", e)

    return order


@api_router.get("/loyalty/{guest_id}", response_model=Loyalty)
async def get_loyalty(guest_id: str):
    doc = await db.loyalty.find_one({"guest_id": guest_id}, {"_id": 0})
    if not doc:
        return Loyalty(guest_id=guest_id)
    return Loyalty(**doc)


@api_router.get("/orders", response_model=List[Order])
async def list_orders(request: Request, guest_id: str = Query(...)):
    # If the caller is authenticated, return all of their orders
    # (by user_id) plus any guest-bound ones with this guest_id.
    current_user = await get_current_user_optional(request)
    if current_user:
        query: dict = {"$or": [
            {"user_id": current_user["id"]},
            {"guest_id": guest_id},
        ]}
    else:
        query = {"guest_id": guest_id}
    items = await db.orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [with_status(o) for o in items]


@api_router.get("/orders/{order_id}", response_model=Order)
async def get_order(order_id: str):
    item = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    return with_status(item)


# ====================================================================
# TELEGRAM NOTIFICATIONS (fire-and-forget on new orders)
# ====================================================================

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "").strip()


async def _get_telegram_config() -> tuple[str, str]:
    """Read Telegram config from DB first, fall back to env."""
    doc = await db.app_config.find_one({"_id": "telegram"})
    if doc:
        token = (doc.get("bot_token") or "").strip()
        chat_id = (doc.get("chat_id") or "").strip()
        if token and chat_id:
            return token, chat_id
    return TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID


async def _get_alerts_chat_id() -> str:
    """Read the (optional) dedicated alerts chat id, fall back to the orders chat id."""
    doc = await db.app_config.find_one({"_id": "telegram"})
    if doc:
        alerts = (doc.get("alerts_chat_id") or "").strip()
        if alerts:
            return alerts
    # Fallback to main chat
    _, chat_id = await _get_telegram_config()
    return chat_id


# ----- Resend (transactional email) -----
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
SHOP_NAME = os.getenv("SHOP_NAME", "La Cave 420").strip()
EMAIL_FROM = os.getenv("RESEND_FROM", f"{SHOP_NAME} <onboarding@resend.dev>").strip()


async def _get_email_config() -> tuple[str, str]:
    """Read email config from DB, fall back to env."""
    doc = await db.app_config.find_one({"_id": "email"})
    if doc:
        api_key = (doc.get("api_key") or "").strip()
        sender = (doc.get("from_email") or "").strip()
        if api_key:
            return api_key, sender or EMAIL_FROM
    return RESEND_API_KEY, EMAIL_FROM


async def send_email_via_resend(to_email: str, subject: str, html: str) -> bool:
    api_key, sender = await _get_email_config()
    if not api_key or not to_email:
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client_h:
            r = await client_h.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": sender,
                    "to": [to_email],
                    "subject": subject,
                    "html": html,
                },
            )
            if r.status_code in (200, 202):
                return True
            logger.warning("[resend] non-2xx (%s): %s", r.status_code, r.text[:400])
    except Exception as e:
        logger.warning("[resend] error: %s", e)
    return False


def _format_items_html(order: Order) -> str:
    rows = []
    for it in order.items:
        variant = f" ({_esc(it.variant_label)})" if it.variant_label else ""
        line_total = it.price * it.quantity
        rows.append(
            f"<tr><td style='padding:6px 0;color:#cbd5e1'>{it.quantity}× {_esc(it.name)}{variant}</td>"
            f"<td style='padding:6px 0;color:#cbd5e1;text-align:right'>"
            f"{('%.2f' % line_total).replace('.', ',')} €</td></tr>"
        )
    return "\n".join(rows)


def _build_email_html(order: Order, title: str, intro: str, accent: str = "#2267EE") -> str:
    is_pickup = (order.delivery_mode or "delivery") == "pickup"
    mode_label = "Retrait sur place 🏪" if is_pickup else "Livraison à domicile 🚚"
    addr_block = ""
    if not is_pickup and order.address:
        addr_block = f"""
        <tr><td style='padding:6px 0;color:#94a3b8'>Adresse</td>
        <td style='padding:6px 0;color:#fff;text-align:right'>{_esc(order.address)}</td></tr>"""
    promo_block = ""
    if order.discount_amount > 0:
        promo_label = f" ({_esc(order.promo_code)})" if order.promo_code else ""
        promo_block = f"""
        <tr><td style='padding:6px 0;color:#94a3b8'>Réduction{promo_label}</td>
        <td style='padding:6px 0;color:#4ADE80;text-align:right'>− {('%.2f' % order.discount_amount).replace('.', ',')} €</td></tr>"""
    return f"""<!doctype html>
<html lang="fr">
<body style="margin:0;padding:0;background:#0B1018;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#fff">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0B1018;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background:#111827;border-radius:16px;overflow:hidden">
        <tr><td style="padding:32px 32px 16px">
          <div style="display:inline-block;padding:6px 14px;background:rgba(34,103,238,0.18);color:{accent};border-radius:999px;font-weight:700;font-size:12px;letter-spacing:1px;text-transform:uppercase">{_esc(SHOP_NAME)}</div>
          <h1 style="margin:18px 0 6px;font-size:24px;font-weight:800;color:#fff">{_esc(title)}</h1>
          <p style="margin:0;color:#94a3b8;font-size:15px;line-height:22px">{_esc(intro)}</p>
        </td></tr>
        <tr><td style="padding:8px 32px 0">
          <div style="background:#0F172A;border:1px solid #1F2937;border-radius:12px;padding:18px">
            <div style="font-size:12px;letter-spacing:1px;color:#94a3b8;text-transform:uppercase;margin-bottom:8px">Commande #{_esc(order.id[:8].upper())}</div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px">
              <tr><td style='padding:6px 0;color:#94a3b8'>Mode</td>
              <td style='padding:6px 0;color:#fff;text-align:right'>{mode_label}</td></tr>
              {addr_block}
              <tr><td colspan="2" style="border-top:1px solid #1F2937;padding-top:10px"></td></tr>
              {_format_items_html(order)}
              <tr><td colspan="2" style="border-top:1px solid #1F2937;padding-top:10px"></td></tr>
              <tr><td style='padding:6px 0;color:#94a3b8'>Sous-total</td>
              <td style='padding:6px 0;color:#fff;text-align:right'>{('%.2f' % order.subtotal).replace('.', ',')} €</td></tr>
              {promo_block}
              <tr><td style='padding:10px 0 0;color:#fff;font-weight:700;font-size:16px'>Total</td>
              <td style='padding:10px 0 0;color:{accent};text-align:right;font-weight:800;font-size:18px'>{('%.2f' % order.total).replace('.', ',')} €</td></tr>
            </table>
          </div>
        </td></tr>
        <tr><td style="padding:24px 32px 32px;color:#64748b;font-size:13px;line-height:20px">
          Merci pour votre confiance !<br>
          L'équipe {_esc(SHOP_NAME)} 🌿
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def email_for_status(order: Order, order_status: str) -> tuple[str, str, str, str] | None:
    """Return (subject, title, intro, accent) for a given status, or None if no email should be sent."""
    if order_status == "En cours":
        return (
            f"Commande confirmée — {SHOP_NAME}",
            "Commande reçue 🎉",
            "Nous avons bien reçu votre commande et nous la préparons. Vous serez notifié dès qu'elle sera prête.",
            "#7AB1FF",
        )
    if order_status == "Terminée":
        is_pickup = (order.delivery_mode or "delivery") == "pickup"
        return (
            f"Votre commande est prête — {SHOP_NAME}",
            "C'est prêt ! ✨",
            (
                "Votre commande est prête à être retirée à la boutique."
                if is_pickup
                else "Votre commande a été livrée. Bonne dégustation !"
            ),
            "#4ADE80",
        )
    if order_status == "Annulée":
        return (
            f"Commande annulée — {SHOP_NAME}",
            "Commande annulée",
            "Votre commande a été annulée. Si vous avez la moindre question, contactez-nous directement en boutique.",
            "#FCA5A5",
        )
    return None


async def send_status_email(order: Order, order_status: str) -> None:
    if not order.customer_email:
        return
    payload = email_for_status(order, order_status)
    if not payload:
        return
    subject, title, intro, accent = payload
    html = _build_email_html(order, title, intro, accent)
    await send_email_via_resend(order.customer_email, subject, html)


def _esc(s) -> str:
    return html_lib.escape(str(s or ""), quote=False)


def _format_order_html(order: Order) -> str:
    is_pickup = (order.delivery_mode or "delivery") == "pickup"
    mode_line = "🏪 <b>Retrait sur place</b>" if is_pickup else "🚚 <b>Livraison</b>"
    lines = [
        f"🛒 <b>Nouvelle commande</b> #{_esc(order.id[:8].upper())}",
        f"👤 <b>{_esc(order.customer_name)}</b>" + (f" · {_esc(order.phone)}" if order.phone else ""),
        mode_line,
    ]
    if not is_pickup and order.address:
        lines.append(f"📍 {_esc(order.address)}")
    lines.append("")
    lines.append("<b>📦 Articles :</b>")
    for it in order.items:
        variant = f" ({_esc(it.variant_label)})" if it.variant_label else ""
        line_total = it.price * it.quantity
        lines.append(f"  • {it.quantity}× {_esc(it.name)}{variant} — {line_total:.2f} €".replace(".", ","))
    lines.append("")
    lines.append(f"💰 Sous-total : <b>{order.subtotal:.2f} €</b>".replace(".", ","))
    if order.discount_amount > 0:
        promo = f" ({_esc(order.promo_code)})" if order.promo_code else ""
        lines.append(f"🎟️ Code promo{promo} : −{order.discount_amount:.2f} €".replace(".", ","))
    lines.append(f"✅ <b>Total : {order.total:.2f} €</b>".replace(".", ","))
    if order.notes:
        lines.append("")
        lines.append(f"📝 <i>Notes :</i> {_esc(order.notes)}")
    try:
        dt = datetime.fromisoformat(order.created_at)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        lines.append(f"🕐 {dt.strftime('%d/%m/%Y à %H:%M')}")
    except Exception:
        pass
    return "\n".join(lines)


async def send_telegram_order_notification(order: Order) -> None:
    token, chat_id = await _get_telegram_config()
    if not token or not chat_id:
        logger.info("[telegram] skip: bot token or chat id not configured")
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": _format_order_html(order),
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
        "reply_markup": _order_action_keyboard(order.id, order.status or "En cours"),
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client_h:
            r = await client_h.post(url, json=payload)
            if r.status_code != 200:
                logger.warning("[telegram] non-200 (%s): %s", r.status_code, r.text[:300])
            else:
                # Store message_id in DB so we can edit it later when status changes
                try:
                    data = r.json()
                    msg_id = data.get("result", {}).get("message_id")
                    if msg_id:
                        await db.orders.update_one(
                            {"id": order.id},
                            {"$set": {"telegram_message_id": msg_id, "telegram_chat_id": str(chat_id)}},
                        )
                except Exception as e:
                    logger.warning("[telegram] failed to persist message_id: %s", e)
    except Exception as e:
        logger.warning("[telegram] error: %s", e)


def _order_action_keyboard(order_id: str, current_status: str) -> dict:
    """Build the inline keyboard shown under each order notification."""
    is_done = current_status == "Terminée"
    is_cancelled = current_status == "Annulée"
    row1 = []
    if not is_done:
        row1.append({"text": "✅ Terminer", "callback_data": f"done:{order_id}"})
    if not is_cancelled:
        row1.append({"text": "❌ Annuler", "callback_data": f"cancel:{order_id}"})
    if is_done or is_cancelled:
        row1.append({"text": "🔄 Remettre en cours", "callback_data": f"reopen:{order_id}"})
    return {"inline_keyboard": [row1]}


async def _telegram_edit_order_message(order: Order) -> None:
    """Edit the existing Telegram message attached to an order to reflect the new status."""
    raw = await db.orders.find_one({"id": order.id}, {"_id": 0, "telegram_message_id": 1, "telegram_chat_id": 1})
    if not raw:
        return
    msg_id = raw.get("telegram_message_id")
    chat_id = raw.get("telegram_chat_id")
    if not msg_id or not chat_id:
        return
    token, _ = await _get_telegram_config()
    if not token:
        return
    status_line = ""
    if order.status == "Terminée":
        status_line = "\n\n✅ <b>Marquée comme TERMINÉE</b>"
    elif order.status == "Annulée":
        status_line = "\n\n❌ <b>Marquée comme ANNULÉE</b>"
    else:
        status_line = "\n\n🔄 <b>Remise EN COURS</b>"
    new_text = _format_order_html(order) + status_line
    try:
        async with httpx.AsyncClient(timeout=8.0) as client_h:
            await client_h.post(
                f"https://api.telegram.org/bot{token}/editMessageText",
                json={
                    "chat_id": chat_id,
                    "message_id": msg_id,
                    "text": new_text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                    "reply_markup": _order_action_keyboard(order.id, order.status or "En cours"),
                },
            )
    except Exception as e:
        logger.warning("[telegram] edit error: %s", e)


async def _telegram_answer_callback(callback_id: str, text: str = "") -> None:
    token, _ = await _get_telegram_config()
    if not token:
        return
    try:
        async with httpx.AsyncClient(timeout=5.0) as client_h:
            await client_h.post(
                f"https://api.telegram.org/bot{token}/answerCallbackQuery",
                json={"callback_query_id": callback_id, "text": text},
            )
    except Exception as e:
        logger.warning("[telegram] answer cb error: %s", e)


async def send_low_stock_alert(alerts: list[dict]) -> None:
    """Send a Telegram message to the admin when one or more variants
    crossed their low-stock threshold or just went out of stock."""
    if not alerts:
        return
    token, _ = await _get_telegram_config()
    if not token:
        return
    target_chat = await _get_alerts_chat_id()
    if not target_chat:
        return
    lines = ["⚠️ <b>Alerte stock</b>"]
    for a in alerts:
        name = _esc(a.get("name") or "")
        label = _esc(a.get("label") or "")
        remaining = int(a.get("remaining", 0))
        if a.get("out_of_stock") or remaining == 0:
            lines.append(f"  ❌ <b>{name} ({label})</b> — en rupture")
        else:
            unit_s = "" if remaining > 1 else ""
            lines.append(f"  🟠 <b>{name} ({label})</b> — plus que {remaining} restant{unit_s}")
    text = "\n".join(lines)
    try:
        async with httpx.AsyncClient(timeout=8.0) as client_h:
            await client_h.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={
                    "chat_id": target_chat,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
            )
    except Exception as e:
        logger.warning("[telegram] low-stock send error: %s", e)


class TelegramConfigIn(BaseModel):
    bot_token: str
    chat_id: str = ""
    alerts_chat_id: str = ""


def _mask_token(t: str) -> str:
    if not t:
        return ""
    if len(t) <= 8:
        return "•" * len(t)
    return f"{t[:6]}…{t[-4:]}"


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

    before_doc = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not before_doc:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    prev_status = with_status(dict(before_doc)).get("status")

    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"manual_status": payload.status}},
    )

    new_status = payload.status

    # Restock items when an order transitions INTO "Annulée"
    if new_status == "Annulée" and prev_status != "Annulée":
        await _restock_order_items(before_doc.get("items") or [])
    # Re-decrement items if an order is UN-cancelled (back to active state)
    elif prev_status == "Annulée" and new_status != "Annulée":
        await _decrement_order_items(before_doc.get("items") or [])

    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    updated_order = with_status(updated)

    # Update the Telegram message reflecting the new status (if it has one)
    if new_status != prev_status:
        try:
            await _telegram_edit_order_message(Order(**updated_order))
        except Exception as e:
            logger.warning("[telegram] edit on status change: %s", e)

    return updated_order


async def _restock_order_items(items: list) -> None:
    """Add back order quantities to the corresponding variants."""
    agg: dict[tuple[str, str], int] = {}
    for it in items or []:
        label = it.get("variant_label")
        pid = it.get("product_id")
        if not label or not pid:
            continue
        qty = int(it.get("quantity") or 0)
        if qty <= 0:
            continue
        agg[(pid, label)] = agg.get((pid, label), 0) + qty
    for (pid, label), qty in agg.items():
        product = await db.products.find_one({"id": pid}, {"_id": 0})
        if not product:
            continue
        variants = list(product.get("variants") or [])
        changed = False
        for v in variants:
            if v.get("label") == label and v.get("stock") is not None:
                v["stock"] = int(v["stock"]) + qty
                changed = True
                break
        if changed:
            await db.products.update_one({"id": pid}, {"$set": {"variants": variants}})


async def _decrement_order_items(items: list) -> None:
    agg: dict[tuple[str, str], int] = {}
    for it in items or []:
        label = it.get("variant_label")
        pid = it.get("product_id")
        if not label or not pid:
            continue
        qty = int(it.get("quantity") or 0)
        if qty <= 0:
            continue
        agg[(pid, label)] = agg.get((pid, label), 0) + qty
    for (pid, label), qty in agg.items():
        product = await db.products.find_one({"id": pid}, {"_id": 0})
        if not product:
            continue
        variants = list(product.get("variants") or [])
        changed = False
        for v in variants:
            if v.get("label") == label and v.get("stock") is not None:
                v["stock"] = max(0, int(v["stock"]) - qty)
                changed = True
                break
        if changed:
            await db.products.update_one({"id": pid}, {"$set": {"variants": variants}})


@api_router.delete("/admin/orders/{order_id}")
async def admin_delete_order(order_id: str, _admin: dict = Depends(require_admin)):
    result = await db.orders.delete_one({"id": order_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    return {"status": "ok", "deleted": 1}


class BulkDeleteOrdersIn(BaseModel):
    ids: List[str]


@api_router.post("/admin/orders/bulk-delete")
async def admin_bulk_delete_orders(payload: BulkDeleteOrdersIn, _admin: dict = Depends(require_admin)):
    if not payload.ids:
        return {"status": "ok", "deleted": 0}
    result = await db.orders.delete_many({"id": {"$in": payload.ids}})
    return {"status": "ok", "deleted": result.deleted_count}


@api_router.get("/admin/telegram")
async def admin_get_telegram(_admin: dict = Depends(require_admin)):
    doc = await db.app_config.find_one({"_id": "telegram"}) or {}
    return {
        "bot_token_masked": _mask_token(doc.get("bot_token", "")),
        "has_token": bool(doc.get("bot_token")),
        "chat_id": doc.get("chat_id", ""),
        "alerts_chat_id": doc.get("alerts_chat_id", ""),
    }


@api_router.post("/admin/telegram")
async def admin_save_telegram(payload: TelegramConfigIn, _admin: dict = Depends(require_admin)):
    update: dict = {}
    if payload.bot_token.strip():
        update["bot_token"] = payload.bot_token.strip()
    update["chat_id"] = payload.chat_id.strip()
    update["alerts_chat_id"] = payload.alerts_chat_id.strip()
    await db.app_config.update_one({"_id": "telegram"}, {"$set": update}, upsert=True)
    return {"status": "ok"}


@api_router.post("/admin/telegram/discover")
async def admin_discover_chat(_admin: dict = Depends(require_admin)):
    """Return chats the bot has seen via either getUpdates or webhook-stored sightings."""
    doc = await db.app_config.find_one({"_id": "telegram"}) or {}
    token = (doc.get("bot_token") or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Enregistrez d'abord le token du bot.")

    chats: dict[str, dict] = {}

    # Always include chats seen through the webhook (works even when webhook is active)
    seen = await db.telegram_seen_chats.find({}, {"_id": 0}).sort("last_seen", -1).to_list(100)
    for s in seen:
        if s.get("id"):
            chats[str(s["id"])] = {
                "id": str(s["id"]),
                "type": s.get("type") or "private",
                "title": s.get("title") or "",
            }

    # Also try getUpdates (only works when webhook is NOT set)
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.get(f"https://api.telegram.org/bot{token}/getUpdates")
            data = r.json()
        if data.get("ok"):
            for upd in data.get("result", []):
                msg = upd.get("message") or upd.get("channel_post") or {}
                chat = msg.get("chat")
                if chat and chat.get("id") is not None:
                    cid = str(chat["id"])
                    chats[cid] = {
                        "id": cid,
                        "type": chat.get("type"),
                        "title": chat.get("title") or chat.get("first_name") or "",
                    }
    except Exception as e:
        logger.info("[telegram] getUpdates skipped: %s", e)

    return {"chats": list(chats.values())}


@api_router.post("/admin/telegram/test")
async def admin_test_telegram(_admin: dict = Depends(require_admin)):
    token, chat_id = await _get_telegram_config()
    if not token or not chat_id:
        raise HTTPException(status_code=400, detail="Configurez d'abord le bot et le chat.")
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    text = "✅ <b>Test réussi !</b>\nVotre boutique CBD est bien connectée à ce chat. Vous recevrez chaque nouvelle commande ici."
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"})
            if r.status_code != 200:
                raise HTTPException(status_code=400, detail=r.json().get("description") or r.text)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur réseau : {e}") from e
    return {"status": "ok"}


# ---------------- Telegram inline-keyboard webhook ----------------

BACKEND_BASE_URL = (os.getenv("BACKEND_BASE_URL", "") or "").rstrip("/")


async def _ensure_webhook_secret() -> str:
    """Return the configured webhook secret, generating one if missing."""
    doc = await db.app_config.find_one({"_id": "telegram"}) or {}
    secret = (doc.get("webhook_secret") or "").strip()
    if not secret:
        secret = secrets.token_urlsafe(24)
        await db.app_config.update_one(
            {"_id": "telegram"},
            {"$set": {"webhook_secret": secret}},
            upsert=True,
        )
    return secret


@api_router.post("/admin/telegram/setup-webhook")
async def admin_setup_telegram_webhook(_admin: dict = Depends(require_admin)):
    """Register the webhook URL with Telegram so the bot forwards button clicks
    and /start messages used for the customer Magic Link login flow."""
    token, _ = await _get_telegram_config()
    if not token:
        raise HTTPException(status_code=400, detail="Configurez d'abord le bot Telegram.")
    if not BACKEND_BASE_URL:
        raise HTTPException(status_code=500, detail="BACKEND_BASE_URL non configuré côté serveur.")
    secret = await _ensure_webhook_secret()
    webhook_url = f"{BACKEND_BASE_URL}/api/telegram/webhook"

    bot_username = ""
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            # Fetch bot identity (username) so the frontend can build t.me/<username> links
            me = await c.get(f"https://api.telegram.org/bot{token}/getMe")
            me_data = me.json()
            if me_data.get("ok"):
                bot_username = me_data.get("result", {}).get("username") or ""
            # Register webhook
            r = await c.post(
                f"https://api.telegram.org/bot{token}/setWebhook",
                json={
                    "url": webhook_url,
                    "secret_token": secret,
                    "allowed_updates": ["callback_query", "message"],
                },
            )
            data = r.json()
            if not data.get("ok"):
                raise HTTPException(status_code=400, detail=data.get("description") or r.text)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur réseau : {e}") from e

    # Persist bot username for the frontend to build t.me URLs
    if bot_username:
        await db.app_config.update_one(
            {"_id": "telegram"},
            {"$set": {"bot_username": bot_username}},
            upsert=True,
        )

    return {"status": "ok", "webhook_url": webhook_url, "bot_username": bot_username}


@api_router.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    """Receives callback_query updates and /start <login_token> messages from Telegram."""
    expected = await _ensure_webhook_secret()
    incoming = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if not incoming or incoming != expected:
        return {"ok": True}

    try:
        update = await request.json()
    except Exception:
        return {"ok": True}

    # ---- Handle /start <token> messages for customer login ----
    msg = update.get("message")
    if msg:
        text = (msg.get("text") or "").strip()
        # Remember chat sighting so the admin "Détecter" picker can show it
        try:
            chat = msg.get("chat") or {}
            if chat.get("id") is not None:
                title = chat.get("title") or chat.get("first_name") or chat.get("username") or ""
                await db.telegram_seen_chats.update_one(
                    {"id": str(chat["id"])},
                    {"$set": {
                        "id": str(chat["id"]),
                        "type": chat.get("type"),
                        "title": title,
                        "last_seen": datetime.now(timezone.utc).isoformat(),
                    }},
                    upsert=True,
                )
        except Exception as e:
            logger.warning("[telegram] seen_chats persist err: %s", e)

        if text.startswith("/start"):
            await _handle_telegram_start(msg, text)
        return {"ok": True}

    cb = update.get("callback_query")
    if not cb:
        return {"ok": True}

    data = (cb.get("data") or "").strip()
    cb_id = cb.get("id")
    from_chat = str(((cb.get("message") or {}).get("chat") or {}).get("id") or "")

    _, configured_chat = await _get_telegram_config()
    if configured_chat and from_chat and from_chat != str(configured_chat):
        await _telegram_answer_callback(cb_id, "Action refusée (chat non autorisé).")
        return {"ok": True}

    if ":" not in data:
        await _telegram_answer_callback(cb_id, "Action inconnue.")
        return {"ok": True}

    action, order_id = data.split(":", 1)
    target_status = {"done": "Terminée", "cancel": "Annulée", "reopen": "En cours"}.get(action)
    if not target_status:
        await _telegram_answer_callback(cb_id, "Action inconnue.")
        return {"ok": True}

    before_doc = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not before_doc:
        await _telegram_answer_callback(cb_id, "Commande introuvable.")
        return {"ok": True}

    prev_status = with_status(dict(before_doc)).get("status")
    if prev_status == target_status:
        await _telegram_answer_callback(cb_id, f"Déjà « {target_status} ».")
        return {"ok": True}

    await db.orders.update_one({"id": order_id}, {"$set": {"manual_status": target_status}})

    if target_status == "Annulée" and prev_status != "Annulée":
        await _restock_order_items(before_doc.get("items") or [])
    elif prev_status == "Annulée" and target_status != "Annulée":
        await _decrement_order_items(before_doc.get("items") or [])

    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    updated_order = with_status(updated)
    try:
        await _telegram_edit_order_message(Order(**updated_order))
    except Exception as e:
        logger.warning("[telegram] edit on webhook: %s", e)

    feedback = {
        "Terminée": "✅ Commande marquée comme terminée",
        "Annulée": "❌ Commande annulée (stock restitué)",
        "En cours": "🔄 Commande remise en cours",
    }[target_status]
    await _telegram_answer_callback(cb_id, feedback)
    return {"ok": True}


# ---------------- Public: promo validation ----------------

class PromoValidateIn(BaseModel):
    code: str
    subtotal: float


class PromoValidateOut(BaseModel):
    valid: bool
    code: Optional[str] = None
    kind: Optional[str] = None
    discount: float = 0.0
    error: Optional[str] = None


@api_router.post("/promo/validate", response_model=PromoValidateOut)
async def promo_validate(payload: PromoValidateIn):
    code = (payload.code or "").strip().upper()
    if not code:
        return PromoValidateOut(valid=False, error="Code vide.")
    promo = await db.promo_codes.find_one({"code": code}, {"_id": 0})
    if not promo:
        return PromoValidateOut(valid=False, error="Code inconnu.")
    d, err = evaluate_promo(promo, float(payload.subtotal))
    if err:
        return PromoValidateOut(valid=False, error=err)
    return PromoValidateOut(valid=True, code=code, kind=promo.get("kind"), discount=d)


# ---------------- Customer auth (Telegram Magic Link) ----------------


async def _telegram_send_message(chat_id: int, text: str) -> None:
    token, _ = await _get_telegram_config()
    if not token:
        return
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            await c.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            )
    except Exception as e:
        logger.warning("[telegram] private msg error: %s", e)


async def _handle_telegram_start(msg: dict, text: str) -> None:
    """Handle /start [<login_token>] messages. If a login token is provided and valid,
    bind this Telegram user to the pending login attempt."""
    from_user = msg.get("from") or {}
    tg_user_id = from_user.get("id")
    chat_id = (msg.get("chat") or {}).get("id")
    if not tg_user_id or not chat_id:
        return

    parts = text.split(maxsplit=1)
    arg = parts[1].strip() if len(parts) > 1 else ""

    # No login token → just acknowledge the user
    if not arg:
        await _telegram_send_message(
            chat_id,
            "👋 <b>Bonjour !</b>\nCe bot est utilisé pour vous connecter à <b>La Cave 420</b>. "
            "Retournez à l'application et appuyez sur <b>« Se connecter avec Telegram »</b>.",
        )
        return

    # Validate the login attempt
    attempt = await db.login_attempts.find_one({"token": arg})
    if not attempt:
        await _telegram_send_message(chat_id, "❌ Lien de connexion invalide ou expiré. Réessayez depuis l'app.")
        return
    if attempt.get("status") != "pending":
        await _telegram_send_message(chat_id, "Cette session est déjà utilisée. Relancez la connexion depuis l'app.")
        return
    try:
        exp = attempt.get("expires_at")
        if exp and datetime.fromisoformat(exp) < datetime.now(timezone.utc):
            await db.login_attempts.update_one({"token": arg}, {"$set": {"status": "expired"}})
            await _telegram_send_message(chat_id, "⏰ Lien expiré. Relancez la connexion depuis l'app.")
            return
    except Exception:
        pass

    # Find or create the user record
    name = (from_user.get("first_name") or "") + (
        f" {from_user.get('last_name')}" if from_user.get("last_name") else ""
    )
    name = name.strip()
    username = from_user.get("username")

    existing = await db.users.find_one({"telegram_user_id": tg_user_id}, {"_id": 0})
    if existing:
        user = existing
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {
                "name": name or user.get("name", ""),
                "telegram_username": username,
                "last_login_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
    else:
        user = User(
            telegram_user_id=tg_user_id,
            telegram_username=username,
            name=name,
        ).dict()
        user["last_login_at"] = datetime.now(timezone.utc).isoformat()
        await db.users.insert_one(user)

    # Link existing guest orders (associated with the guest_id stored on the attempt)
    guest_id = attempt.get("guest_id")
    if guest_id:
        await db.orders.update_many(
            {"guest_id": guest_id},
            {"$set": {"user_id": user["id"]}},
        )

    # Mark login attempt as approved + persist Telegram user id
    await db.login_attempts.update_one(
        {"token": arg},
        {"$set": {
            "status": "approved",
            "user_id": user["id"],
            "telegram_user_id": tg_user_id,
            "approved_at": datetime.now(timezone.utc).isoformat(),
        }},
    )

    await _telegram_send_message(
        chat_id,
        f"✅ <b>Connecté !</b>\nBonjour {_esc(name or 'à toi')} 👋\n"
        f"Tu peux retourner sur <b>La Cave 420</b>, ton compte est prêt.",
    )


@api_router.get("/auth/telegram/bot")
async def auth_get_bot_username():
    """Public: returns the configured bot username so the app can build a t.me link."""
    doc = await db.app_config.find_one({"_id": "telegram"}) or {}
    return {"bot_username": (doc.get("bot_username") or "").strip()}


class TelegramLoginStartIn(BaseModel):
    guest_id: Optional[str] = ""


@api_router.post("/auth/telegram/start")
async def auth_telegram_start(payload: TelegramLoginStartIn):
    """Create a new login attempt and return the t.me deep link for the customer."""
    doc = await db.app_config.find_one({"_id": "telegram"}) or {}
    bot_username = (doc.get("bot_username") or "").strip()
    if not bot_username:
        raise HTTPException(status_code=400, detail="Bot Telegram non configuré. Demandez à la boutique.")
    token = secrets.token_urlsafe(20)
    now = datetime.now(timezone.utc)
    await db.login_attempts.insert_one({
        "token": token,
        "status": "pending",
        "guest_id": (payload.guest_id or "").strip(),
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=10)).isoformat(),
    })
    return {
        "token": token,
        "telegram_url": f"https://t.me/{bot_username}?start={token}",
        "expires_in": 600,
    }


@api_router.get("/auth/telegram/check")
async def auth_telegram_check(token: str):
    """Polled by the app while the user authorises the login from Telegram."""
    attempt = await db.login_attempts.find_one({"token": token}, {"_id": 0})
    if not attempt:
        return {"status": "invalid"}
    s = attempt.get("status")
    if s == "pending":
        try:
            exp = datetime.fromisoformat(attempt.get("expires_at") or "")
            if exp < datetime.now(timezone.utc):
                await db.login_attempts.update_one({"token": token}, {"$set": {"status": "expired"}})
                return {"status": "expired"}
        except Exception:
            pass
        return {"status": "pending"}
    if s == "approved":
        user = await db.users.find_one({"id": attempt.get("user_id")}, {"_id": 0})
        if not user:
            return {"status": "invalid"}
        jwt_token = issue_user_token(user["id"])
        # One-shot: mark consumed so it cannot be re-checked
        await db.login_attempts.update_one({"token": token}, {"$set": {"status": "consumed"}})
        return {
            "status": "approved",
            "token": jwt_token,
            "user": {
                "id": user["id"],
                "name": user.get("name", ""),
                "telegram_username": user.get("telegram_username"),
            },
        }
    return {"status": s or "invalid"}


@api_router.get("/auth/me")
async def auth_me(request: Request):
    user = await get_current_user_optional(request)
    if not user:
        raise HTTPException(status_code=401, detail="Non connecté")
    return {
        "id": user["id"],
        "name": user.get("name", ""),
        "phone": user.get("phone", ""),
        "telegram_username": user.get("telegram_username"),
    }


# ---------------- Admin: promo codes CRUD ----------------

class PromoCodeIn(BaseModel):
    code: str
    kind: str  # "percent" | "amount" | "amount_min"
    value: float
    min_subtotal: float = 0.0
    max_uses: Optional[int] = None
    expires_at: Optional[str] = None
    enabled: bool = True


class PromoCodePatch(BaseModel):
    enabled: Optional[bool] = None
    max_uses: Optional[int] = None
    expires_at: Optional[str] = None
    value: Optional[float] = None
    min_subtotal: Optional[float] = None


@api_router.get("/admin/promo-codes", response_model=List[PromoCode])
async def admin_list_promos(_admin: dict = Depends(require_admin)):
    items = await db.promo_codes.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


@api_router.post("/admin/promo-codes", response_model=PromoCode)
async def admin_create_promo(payload: PromoCodeIn, _admin: dict = Depends(require_admin)):
    if payload.kind not in ("percent", "amount", "amount_min"):
        raise HTTPException(status_code=400, detail="Type invalide")
    code = payload.code.strip().upper()
    if not code or len(code) < 3:
        raise HTTPException(status_code=400, detail="Code trop court (3 caractères min)")
    existing = await db.promo_codes.find_one({"code": code})
    if existing:
        raise HTTPException(status_code=400, detail="Ce code existe déjà.")
    promo = PromoCode(
        code=code,
        kind=payload.kind,
        value=payload.value,
        min_subtotal=payload.min_subtotal,
        max_uses=payload.max_uses,
        expires_at=payload.expires_at,
        enabled=payload.enabled,
    )
    await db.promo_codes.insert_one(promo.dict())
    return promo


@api_router.patch("/admin/promo-codes/{promo_id}", response_model=PromoCode)
async def admin_update_promo(promo_id: str, payload: PromoCodePatch, _admin: dict = Depends(require_admin)):
    update = {k: v for k, v in payload.dict(exclude_unset=True).items()}
    if not update:
        raise HTTPException(status_code=400, detail="Aucun champ")
    result = await db.promo_codes.update_one({"id": promo_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Code introuvable")
    updated = await db.promo_codes.find_one({"id": promo_id}, {"_id": 0})
    return updated


@api_router.delete("/admin/promo-codes/{promo_id}")
async def admin_delete_promo(promo_id: str, _admin: dict = Depends(require_admin)):
    result = await db.promo_codes.delete_one({"id": promo_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Code introuvable")
    return {"status": "ok"}


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

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
import httpx
import html as html_lib
import jwt as pyjwt
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

ORDER_STATUSES = ["En cours", "Terminée"]
ADMIN_STATUS_CHOICES = ["En cours", "Terminée", "Annulée"]


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


class OrderIn(BaseModel):
    guest_id: str
    customer_name: str
    address: str = ""
    phone: str = ""
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
    customer_name: str
    address: str
    phone: str
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
async def create_order(payload: OrderIn):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Le panier est vide")

    delivery_mode = (payload.delivery_mode or "delivery").strip().lower()
    if delivery_mode not in ("delivery", "pickup"):
        delivery_mode = "delivery"
    if delivery_mode == "delivery" and not payload.address.strip():
        raise HTTPException(status_code=400, detail="Adresse de livraison requise")

    product_ids = [i.product_id for i in payload.items]
    products = await db.products.find({"id": {"$in": product_ids}}, {"_id": 0}).to_list(500)
    product_map = {p["id"]: p for p in products}

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
        customer_name=payload.customer_name,
        address=payload.address.strip() if delivery_mode == "delivery" else "",
        phone=payload.phone,
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

    try:
        await send_telegram_order_notification(order)
    except Exception as e:
        logger.warning("[telegram] outer error: %s", e)

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
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client_h:
            r = await client_h.post(url, json=payload)
            if r.status_code != 200:
                logger.warning("[telegram] non-200 (%s): %s", r.status_code, r.text[:300])
    except Exception as e:
        logger.warning("[telegram] error: %s", e)


class TelegramConfigIn(BaseModel):
    bot_token: str
    chat_id: str = ""


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
    result = await db.orders.update_one(
        {"id": order_id},
        {"$set": {"manual_status": payload.status}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return with_status(updated)


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
    }


@api_router.post("/admin/telegram")
async def admin_save_telegram(payload: TelegramConfigIn, _admin: dict = Depends(require_admin)):
    update: dict = {}
    if payload.bot_token.strip():
        update["bot_token"] = payload.bot_token.strip()
    update["chat_id"] = payload.chat_id.strip()
    await db.app_config.update_one({"_id": "telegram"}, {"$set": update}, upsert=True)
    return {"status": "ok"}


@api_router.post("/admin/telegram/discover")
async def admin_discover_chat(_admin: dict = Depends(require_admin)):
    """Call Telegram getUpdates and return any chat_ids the bot has been talking to."""
    doc = await db.app_config.find_one({"_id": "telegram"}) or {}
    token = (doc.get("bot_token") or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Enregistrez d'abord le token du bot.")
    url = f"https://api.telegram.org/bot{token}/getUpdates"
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.get(url)
            data = r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Telegram inaccessible : {e}")
    if not data.get("ok"):
        raise HTTPException(status_code=400, detail=data.get("description") or "Token invalide")
    chats: dict[str, dict] = {}
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
        raise HTTPException(status_code=502, detail=f"Erreur réseau : {e}")
    return {"status": "ok"}


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

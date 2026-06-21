from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

ORDER_STATUSES = ["En préparation", "En livraison", "Livré"]

def compute_status(created_at_iso: str) -> str:
    try:
        dt = datetime.fromisoformat(created_at_iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        elapsed_sec = (datetime.now(timezone.utc) - dt).total_seconds()
    except Exception:
        return ORDER_STATUSES[0]
    if elapsed_sec < 180:  # < 3 min
        return ORDER_STATUSES[0]
    if elapsed_sec < 600:  # < 10 min
        return ORDER_STATUSES[1]
    return ORDER_STATUSES[2]


def with_status(order_doc: dict) -> dict:
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


class Product(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str
    price: float
    image: str
    category_id: str
    category_kind: str  # "restaurant" | "grocery"
    unit: Optional[str] = None  # e.g., "kg", "pièce"
    popular: bool = False
    promo: bool = False


class CartItemIn(BaseModel):
    product_id: str
    quantity: int


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


class Order(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    guest_id: str
    customer_name: str
    address: str
    phone: str
    notes: str = ""
    items: List[OrderItem]
    subtotal: float
    delivery_fee: float
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
        line_total = p["price"] * it.quantity
        subtotal += line_total
        order_items.append(OrderItem(
            product_id=p["id"], name=p["name"], price=p["price"],
            image=p["image"], quantity=it.quantity,
        ))

    # Loyalty: validate use_points against current balance
    loyalty_doc = await db.loyalty.find_one({"guest_id": payload.guest_id}, {"_id": 0})
    current_balance = float(loyalty_doc["points_balance"]) if loyalty_doc else 0.0
    use_points = max(0.0, min(float(payload.use_points or 0.0), current_balance, subtotal))
    use_points = round(use_points, 2)

    discounted_subtotal = max(0.0, subtotal - use_points)
    delivery_fee = 0.0 if discounted_subtotal >= 30 else 2.99
    total = round(discounted_subtotal + delivery_fee, 2)

    # Earn 1€ for every 10€ spent (on discounted subtotal, items only)
    points_earned = round(int(discounted_subtotal // 10) * 1.0, 2)

    order = Order(
        guest_id=payload.guest_id,
        customer_name=payload.customer_name,
        address=payload.address,
        phone=payload.phone,
        notes=payload.notes or "",
        items=order_items,
        subtotal=round(subtotal, 2),
        delivery_fee=delivery_fee,
        points_used=use_points,
        points_earned=points_earned,
        total=total,
    )
    await db.orders.insert_one(order.dict())

    # Update loyalty balance
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

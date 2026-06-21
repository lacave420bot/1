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
    Category(id="burgers", name="Burgers", icon="fast-food", kind="restaurant",
             image="https://images.pexels.com/photos/9814729/pexels-photo-9814729.jpeg"),
    Category(id="salades", name="Salades", icon="leaf", kind="restaurant",
             image="https://images.pexels.com/photos/3298060/pexels-photo-3298060.jpeg"),
    Category(id="pizzas", name="Pizzas", icon="pizza", kind="restaurant",
             image="https://images.unsplash.com/photo-1565299624946-b28f40a0ae38"),
    Category(id="boissons", name="Boissons", icon="wine", kind="restaurant",
             image="https://images.pexels.com/photos/30900665/pexels-photo-30900665.jpeg"),
    Category(id="fruits", name="Fruits & Légumes", icon="nutrition", kind="grocery",
             image="https://images.unsplash.com/photo-1624668430039-0175a0fbf006"),
    Category(id="boulangerie", name="Boulangerie", icon="cafe", kind="grocery",
             image="https://images.unsplash.com/photo-1509440159596-0249088772ff"),
    Category(id="laitiers", name="Produits laitiers", icon="water", kind="grocery",
             image="https://images.unsplash.com/photo-1628088062854-d1870b4553da"),
    Category(id="epicerie", name="Épicerie", icon="basket", kind="grocery",
             image="https://images.unsplash.com/photo-1542838132-92c53300491e"),
]

PRODUCTS: List[Product] = [
    # Restaurant
    Product(name="Burger Classique", description="Bœuf, cheddar fondu, salade, tomate, oignons caramélisés, sauce maison.",
            price=9.50, image="https://images.unsplash.com/photo-1568901346375-23c9450c58cd",
            category_id="burgers", category_kind="restaurant", popular=True, promo=True),
    Product(name="Cheeseburger Bacon", description="Double cheddar, bacon croustillant, oignons frits, sauce BBQ.",
            price=11.90, image="https://images.unsplash.com/photo-1565299507177-b0ac66763828",
            category_id="burgers", category_kind="restaurant", popular=True),
    Product(name="Veggie Burger", description="Steak végétal aux légumes, avocat, salade, sauce yaourt aux herbes.",
            price=10.50, image="https://images.unsplash.com/photo-1520072959219-c595dc870360",
            category_id="burgers", category_kind="restaurant"),
    Product(name="Salade César", description="Poulet grillé, croûtons, parmesan, sauce César onctueuse.",
            price=8.90, image="https://images.unsplash.com/photo-1546793665-c74683f339c1",
            category_id="salades", category_kind="restaurant", popular=True),
    Product(name="Salade du Marché", description="Quinoa, avocat, tomates cerises, feta, graines, vinaigrette citron.",
            price=9.50, image="https://images.pexels.com/photos/3298060/pexels-photo-3298060.jpeg",
            category_id="salades", category_kind="restaurant"),
    Product(name="Pizza Margherita", description="Sauce tomate, mozzarella di Bufala, basilic frais, huile d'olive.",
            price=10.90, image="https://images.unsplash.com/photo-1574071318508-1cdbab80d002",
            category_id="pizzas", category_kind="restaurant", popular=True),
    Product(name="Pizza 4 Fromages", description="Mozzarella, gorgonzola, parmesan, chèvre. Un délice fondant.",
            price=12.90, image="https://images.unsplash.com/photo-1513104890138-7c749659a591",
            category_id="pizzas", category_kind="restaurant", promo=True),
    Product(name="Limonade Maison", description="Citron pressé, eau pétillante, menthe fraîche. Rafraîchissante.",
            price=3.50, image="https://images.pexels.com/photos/30900665/pexels-photo-30900665.jpeg",
            category_id="boissons", category_kind="restaurant"),
    Product(name="Smoothie Fruits Rouges", description="Fraise, framboise, myrtille, yaourt grec, miel.",
            price=4.90, image="https://images.unsplash.com/photo-1638176067000-9e2017b58a36",
            category_id="boissons", category_kind="restaurant", popular=True),
    # Grocery
    Product(name="Pommes Gala", description="Pommes Gala croquantes et sucrées. Origine France.",
            price=2.50, unit="kg", image="https://images.unsplash.com/photo-1568702846914-96b305d2aaeb",
            category_id="fruits", category_kind="grocery"),
    Product(name="Bananes Bio", description="Bananes biologiques équitables. Riches en potassium.",
            price=2.20, unit="kg", image="https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e",
            category_id="fruits", category_kind="grocery", popular=True),
    Product(name="Tomates Cerises", description="Tomates cerises sucrées et juteuses. Barquette 250g.",
            price=2.90, unit="250g", image="https://images.unsplash.com/photo-1592924357228-91a4daadcfea",
            category_id="fruits", category_kind="grocery"),
    Product(name="Baguette Tradition", description="Baguette artisanale cuite au four à bois.",
            price=1.20, unit="pièce", image="https://images.unsplash.com/photo-1509440159596-0249088772ff",
            category_id="boulangerie", category_kind="grocery", popular=True),
    Product(name="Croissants au Beurre", description="Croissants pur beurre AOP. Lot de 4.",
            price=4.50, unit="x4", image="https://images.unsplash.com/photo-1555507036-ab1f4038808a",
            category_id="boulangerie", category_kind="grocery", promo=True),
    Product(name="Lait Demi-Écrémé", description="Lait demi-écrémé UHT. Bouteille 1L.",
            price=1.10, unit="1L", image="https://images.unsplash.com/photo-1628088062854-d1870b4553da",
            category_id="laitiers", category_kind="grocery"),
    Product(name="Yaourts Nature Bio", description="Yaourts nature bio. Pack de 4 pots.",
            price=2.80, unit="x4", image="https://images.unsplash.com/photo-1571212515416-fef01fc43637",
            category_id="laitiers", category_kind="grocery"),
    Product(name="Pâtes Penne", description="Pâtes penne de blé dur. Paquet 500g.",
            price=1.50, unit="500g", image="https://images.unsplash.com/photo-1551462147-37885acc36f1",
            category_id="epicerie", category_kind="grocery"),
    Product(name="Huile d'Olive Extra", description="Huile d'olive vierge extra. Bouteille 75cl.",
            price=8.90, unit="75cl", image="https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5",
            category_id="epicerie", category_kind="grocery", popular=True),
]


@app.on_event("startup")
async def seed_database():
    # Seed categories
    if await db.categories.count_documents({}) == 0:
        await db.categories.insert_many([c.dict() for c in CATEGORIES])
    # Seed products
    if await db.products.count_documents({}) == 0:
        await db.products.insert_many([p.dict() for p in PRODUCTS])


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

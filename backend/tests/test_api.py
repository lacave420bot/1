"""Backend API tests for ordering app (épicerie + restaurant)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') if os.environ.get('EXPO_PUBLIC_BACKEND_URL') else None
# Fallback to public URL from /app/frontend/.env if env var not exposed
if not BASE_URL:
    BASE_URL = "https://order-basket-5.preview.emergentagent.com"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ----- Categories -----
class TestCategories:
    def test_list_categories(self, client):
        r = client.get(f"{BASE_URL}/api/categories", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) == 8
        sample = data[0]
        for k in ("id", "name", "icon", "image", "kind"):
            assert k in sample
        kinds = {c["kind"] for c in data}
        assert kinds == {"restaurant", "grocery"}


# ----- Products -----
class TestProducts:
    def test_list_products_default(self, client):
        r = client.get(f"{BASE_URL}/api/products", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 18
        p = data[0]
        for k in ("id", "name", "description", "price", "image", "category_id", "category_kind"):
            assert k in p

    def test_filter_by_category(self, client):
        r = client.get(f"{BASE_URL}/api/products", params={"category_id": "burgers"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        assert all(p["category_id"] == "burgers" for p in data)

    def test_filter_by_kind(self, client):
        r = client.get(f"{BASE_URL}/api/products", params={"kind": "grocery"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        assert all(p["category_kind"] == "grocery" for p in data)

    def test_filter_popular(self, client):
        r = client.get(f"{BASE_URL}/api/products", params={"popular": "true"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        assert all(p.get("popular") is True for p in data)

    def test_filter_promo(self, client):
        r = client.get(f"{BASE_URL}/api/products", params={"promo": "true"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        assert all(p.get("promo") is True for p in data)

    def test_search_regex(self, client):
        r = client.get(f"{BASE_URL}/api/products", params={"search": "pizza"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        assert all("pizza" in p["name"].lower() for p in data)

    def test_get_product_by_id(self, client):
        r = client.get(f"{BASE_URL}/api/products", timeout=30)
        pid = r.json()[0]["id"]
        r2 = client.get(f"{BASE_URL}/api/products/{pid}", timeout=30)
        assert r2.status_code == 200
        assert r2.json()["id"] == pid

    def test_get_product_404(self, client):
        r = client.get(f"{BASE_URL}/api/products/nonexistent_id_xyz", timeout=30)
        assert r.status_code == 404


# ----- Orders -----
class TestOrders:
    @pytest.fixture(scope="class")
    def guest_id(self):
        return f"TEST_g_{uuid.uuid4().hex[:8]}"

    @pytest.fixture(scope="class")
    def two_products(self, client):
        r = client.get(f"{BASE_URL}/api/products", timeout=30)
        return r.json()[:2]

    def test_create_order_with_delivery_fee(self, client, guest_id, two_products):
        # Small order => delivery_fee 2.99
        p = two_products[0]
        payload = {
            "guest_id": guest_id,
            "customer_name": "TEST Jean Dupont",
            "address": "1 rue de Test, 75001 Paris",
            "phone": "+33 6 12 34 56 78",
            "notes": "Sonner deux fois",
            "items": [{"product_id": p["id"], "quantity": 1}],
        }
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["guest_id"] == guest_id
        assert order["status"] == "En préparation"
        assert order["subtotal"] == round(p["price"] * 1, 2)
        if order["subtotal"] < 30:
            assert order["delivery_fee"] == 2.99
        else:
            assert order["delivery_fee"] == 0.0
        assert order["total"] == round(order["subtotal"] + order["delivery_fee"], 2)
        assert len(order["items"]) == 1
        assert order["items"][0]["product_id"] == p["id"]

        # Verify persistence via GET /orders/{id}
        r2 = client.get(f"{BASE_URL}/api/orders/{order['id']}", timeout=30)
        assert r2.status_code == 200
        assert r2.json()["id"] == order["id"]

    def test_create_order_free_delivery(self, client, guest_id, two_products):
        # Force subtotal >= 30 by using high qty
        p = two_products[0]
        qty = max(1, int(30 // p["price"]) + 1)
        payload = {
            "guest_id": guest_id,
            "customer_name": "TEST Jean Dupont",
            "address": "1 rue de Test",
            "phone": "+33 6 12 34 56 78",
            "items": [{"product_id": p["id"], "quantity": qty}],
        }
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 200
        order = r.json()
        assert order["subtotal"] >= 30
        assert order["delivery_fee"] == 0.0

    def test_create_order_empty_items_400(self, client, guest_id):
        payload = {
            "guest_id": guest_id,
            "customer_name": "X",
            "address": "X",
            "phone": "X",
            "items": [],
        }
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 400

    def test_create_order_unknown_product_400(self, client, guest_id):
        payload = {
            "guest_id": guest_id,
            "customer_name": "X",
            "address": "X",
            "phone": "X",
            "items": [{"product_id": "does-not-exist", "quantity": 1}],
        }
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 400

    def test_list_orders_by_guest(self, client, guest_id):
        r = client.get(f"{BASE_URL}/api/orders", params={"guest_id": guest_id}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 2
        # Sorted desc by created_at
        timestamps = [o["created_at"] for o in data]
        assert timestamps == sorted(timestamps, reverse=True)
        assert all(o["guest_id"] == guest_id for o in data)

    def test_get_order_404(self, client):
        r = client.get(f"{BASE_URL}/api/orders/no-such-order", timeout=30)
        assert r.status_code == 404

    def test_list_orders_missing_guest_id_422(self, client):
        r = client.get(f"{BASE_URL}/api/orders", timeout=30)
        assert r.status_code == 422

"""Iteration 2: loyalty + computed order status backend tests."""
import os
import uuid
import math
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://order-basket-5.preview.emergentagent.com').rstrip('/')


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def products(client):
    r = client.get(f"{BASE_URL}/api/products", timeout=30)
    assert r.status_code == 200
    return r.json()


def _pick_cheap(products, max_price=12):
    return [p for p in products if p["price"] <= max_price]


def _make_items_for_subtotal(products, target_subtotal):
    """Build items list whose subtotal is >= target_subtotal."""
    pool = _pick_cheap(products, max_price=15)
    pool = sorted(pool, key=lambda p: -p["price"])
    items = []
    sub = 0.0
    for p in pool:
        qty = max(1, int(math.ceil((target_subtotal - sub) / p["price"])))
        items.append({"product_id": p["id"], "quantity": qty})
        sub += p["price"] * qty
        if sub >= target_subtotal:
            break
    return items, round(sub, 2)


# ----- Loyalty: unknown guest returns zeros -----
class TestLoyaltyUnknownGuest:
    def test_unknown_guest_returns_zero(self, client):
        gid = f"TEST_unknown_{uuid.uuid4()}"
        r = client.get(f"{BASE_URL}/api/loyalty/{gid}", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["guest_id"] == gid
        assert data["points_balance"] == 0
        assert data["total_earned"] == 0
        assert data["total_spent"] == 0
        assert data["orders_count"] == 0


# ----- Order create: use_points, points_earned, delivery_fee logic -----
class TestOrderLoyaltyFlow:
    @pytest.fixture(scope="class")
    def guest_id(self):
        return f"TEST_loy_{uuid.uuid4()}"

    def test_first_order_below_free_delivery(self, client, products, guest_id):
        # Build subtotal around 25€ -> delivery fee 2.99, points_earned floor(25/10)=2
        items, sub = _make_items_for_subtotal(products, 25)
        payload = {
            "guest_id": guest_id,
            "customer_name": "TEST User",
            "address": "1 rue de Test",
            "phone": "0600000000",
            "use_points": 0,
            "items": items,
        }
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["subtotal"] == sub
        assert order["points_used"] == 0
        assert order["points_earned"] == float(int(sub // 10))
        if sub < 30:
            assert order["delivery_fee"] == 2.99
            assert order["total"] == round(sub + 2.99, 2)
        # Loyalty balance updated
        r2 = client.get(f"{BASE_URL}/api/loyalty/{guest_id}", timeout=30)
        loy = r2.json()
        assert loy["points_balance"] == order["points_earned"]
        assert loy["total_earned"] == order["points_earned"]
        assert loy["orders_count"] == 1
        # store for later
        pytest._first_order_id = order["id"]
        pytest._first_balance = loy["points_balance"]

    def test_second_order_above_free_delivery_uses_points(self, client, products, guest_id):
        # Build subtotal >= 35€ so even after using points stays >= 30 => free delivery
        items, sub = _make_items_for_subtotal(products, 35)
        prev_balance = pytest._first_balance
        use_points = prev_balance  # use everything
        payload = {
            "guest_id": guest_id,
            "customer_name": "TEST User",
            "address": "1 rue de Test",
            "phone": "0600000000",
            "use_points": use_points,
            "items": items,
        }
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["subtotal"] == sub
        assert order["points_used"] == round(use_points, 2)
        discounted = round(sub - use_points, 2)
        expected_earned = float(int(discounted // 10))
        assert order["points_earned"] == expected_earned
        # discounted >= 30 -> free delivery
        if discounted >= 30:
            assert order["delivery_fee"] == 0.0
        # total
        assert order["total"] == round(discounted + order["delivery_fee"], 2)
        # status field present and valid
        assert "status" in order
        assert order["status"] in ("En préparation", "En livraison", "Livré")
        # Loyalty
        loy = client.get(f"{BASE_URL}/api/loyalty/{guest_id}", timeout=30).json()
        expected_balance = round(prev_balance - use_points + expected_earned, 2)
        assert loy["points_balance"] == expected_balance
        assert loy["orders_count"] == 2
        assert loy["total_spent"] == round(use_points, 2)

    def test_use_points_clamped_to_balance(self, client, products, guest_id):
        # try to use way more than balance -> should be clamped
        items, sub = _make_items_for_subtotal(products, 20)
        loy_before = client.get(f"{BASE_URL}/api/loyalty/{guest_id}", timeout=30).json()
        balance_before = loy_before["points_balance"]
        payload = {
            "guest_id": guest_id,
            "customer_name": "TEST User",
            "address": "1 rue de Test",
            "phone": "0600000000",
            "use_points": 9999,  # absurd
            "items": items,
        }
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        order = r.json()
        # points_used must be clamped: not > balance, not > subtotal
        assert order["points_used"] <= balance_before + 0.01
        assert order["points_used"] <= sub + 0.01


# ----- Order status computed from created_at -----
class TestOrderStatusComputed:
    def test_recent_order_status_in_preparation(self, client, products):
        gid = f"TEST_status_{uuid.uuid4()}"
        items, _ = _make_items_for_subtotal(products, 12)
        payload = {
            "guest_id": gid,
            "customer_name": "TEST",
            "address": "x",
            "phone": "0",
            "items": items,
        }
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 200
        order = r.json()
        # fresh order -> En préparation
        assert order["status"] == "En préparation"

        # GET by id returns same/updated status
        r2 = client.get(f"{BASE_URL}/api/orders/{order['id']}", timeout=30)
        assert r2.status_code == 200
        assert r2.json()["status"] in ("En préparation", "En livraison", "Livré")

        # GET list includes status field
        r3 = client.get(f"{BASE_URL}/api/orders", params={"guest_id": gid}, timeout=30)
        assert r3.status_code == 200
        lst = r3.json()
        assert lst and "status" in lst[0]

    def test_get_order_404(self, client):
        r = client.get(f"{BASE_URL}/api/orders/does-not-exist-xyz", timeout=30)
        assert r.status_code == 404

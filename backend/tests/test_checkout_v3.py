"""Iteration 3 backend tests for La Cave 420.
Covers: delivery_mode (delivery/pickup), promo_code application, /api/promo/validate,
and admin auth (PIN 2937)."""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get('EXPO_PUBLIC_BACKEND_URL') or
            "https://order-basket-5.preview.emergentagent.com").rstrip('/')

GUEST_ID = f"TEST_v3_{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def product(client):
    r = client.get(f"{BASE_URL}/api/products", timeout=30)
    assert r.status_code == 200
    # Pick a product with a clean price
    return r.json()[0]


def _make_payload(product, **overrides):
    base = {
        "guest_id": GUEST_ID,
        "customer_name": "TEST V3 Client",
        "address": "1 rue de Paris, 75001 Paris",
        "phone": "+33 6 11 22 33 44",
        "notes": "TEST",
        "delivery_mode": "delivery",
        "items": [{"product_id": product["id"], "quantity": 2}],
    }
    base.update(overrides)
    return base


# ---- Delivery mode ----
class TestDeliveryMode:
    def test_delivery_empty_address_rejected_400(self, client, product):
        payload = _make_payload(product, address="", delivery_mode="delivery")
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 400, r.text
        assert "Adresse" in r.json().get("detail", "")

    def test_delivery_whitespace_address_rejected_400(self, client, product):
        payload = _make_payload(product, address="   ", delivery_mode="delivery")
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 400

    def test_pickup_no_address_ok(self, client, product):
        payload = _make_payload(product, address="", delivery_mode="pickup")
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["delivery_mode"] == "pickup"
        assert order["address"] == ""
        # Verify persistence
        r2 = client.get(f"{BASE_URL}/api/orders/{order['id']}", timeout=30)
        assert r2.status_code == 200
        assert r2.json()["delivery_mode"] == "pickup"
        assert r2.json()["address"] == ""

    def test_pickup_address_provided_is_dropped(self, client, product):
        """When mode=pickup, even a provided address must be wiped server-side."""
        payload = _make_payload(product, address="Should be ignored", delivery_mode="pickup")
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 200
        assert r.json()["address"] == ""

    def test_delivery_with_address_ok(self, client, product):
        payload = _make_payload(product, delivery_mode="delivery")
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 200
        order = r.json()
        assert order["delivery_mode"] == "delivery"
        assert order["address"] == "1 rue de Paris, 75001 Paris"
        assert order["delivery_fee"] == 0.0  # spec: delivery_fee disabled
        assert order["total"] == round(order["subtotal"] - order["discount_amount"], 2)


# ---- Promo codes (POST /api/orders) ----
class TestPromoOnOrder:
    def test_order_with_welcome10_applies_10_percent(self, client, product):
        # subtotal = price * 2
        payload = _make_payload(product, promo_code="WELCOME10")
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        order = r.json()
        expected_disc = round(order["subtotal"] * 0.10, 2)
        assert order["promo_code"] == "WELCOME10"
        assert order["discount_amount"] == expected_disc
        assert order["total"] == round(order["subtotal"] - expected_disc, 2)

    def test_order_with_promo5_applies_5_fixed(self, client, product):
        payload = _make_payload(product, promo_code="PROMO5")
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        order = r.json()
        # PROMO5 should give 5€ off (capped to subtotal)
        expected_disc = round(min(5.0, order["subtotal"]), 2)
        assert order["promo_code"] == "PROMO5"
        assert order["discount_amount"] == expected_disc

    def test_order_with_lowercase_promo_normalized(self, client, product):
        payload = _make_payload(product, promo_code="welcome10")
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        assert r.status_code == 200
        assert r.json()["promo_code"] == "WELCOME10"

    def test_order_with_invalid_promo_ignored(self, client, product):
        payload = _make_payload(product, promo_code="BOGUSCODE")
        r = client.post(f"{BASE_URL}/api/orders", json=payload, timeout=30)
        # spec: invalid promo silently ignored (no error)
        assert r.status_code == 200
        order = r.json()
        assert order["promo_code"] is None
        assert order["discount_amount"] == 0.0


# ---- /api/promo/validate ----
class TestPromoValidate:
    def test_validate_welcome10_percent(self, client):
        r = client.post(f"{BASE_URL}/api/promo/validate",
                        json={"code": "WELCOME10", "subtotal": 50.0}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["valid"] is True
        assert d["code"] == "WELCOME10"
        assert d["kind"] == "percent"
        assert d["discount"] == 5.0

    def test_validate_welcome10_lowercase(self, client):
        r = client.post(f"{BASE_URL}/api/promo/validate",
                        json={"code": "welcome10", "subtotal": 100.0}, timeout=30)
        assert r.status_code == 200
        assert r.json()["valid"] is True
        assert r.json()["discount"] == 10.0

    def test_validate_promo5_fixed(self, client):
        r = client.post(f"{BASE_URL}/api/promo/validate",
                        json={"code": "PROMO5", "subtotal": 30.0}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["valid"] is True
        assert d["kind"] == "amount"
        assert d["discount"] == 5.0

    def test_validate_unknown_code(self, client):
        r = client.post(f"{BASE_URL}/api/promo/validate",
                        json={"code": "DOESNOTEXIST", "subtotal": 50.0}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["valid"] is False
        assert "inconnu" in (d["error"] or "").lower()

    def test_validate_empty_code(self, client):
        r = client.post(f"{BASE_URL}/api/promo/validate",
                        json={"code": "", "subtotal": 50.0}, timeout=30)
        assert r.status_code == 200
        assert r.json()["valid"] is False


# ---- Admin auth ----
class TestAdminAuth:
    def test_admin_login_correct_pin(self, client):
        r = client.post(f"{BASE_URL}/api/admin/login",
                        json={"pin": "2937"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "access_token" in d
        assert d["token_type"] == "bearer"

    def test_admin_login_wrong_pin(self, client):
        r = client.post(f"{BASE_URL}/api/admin/login",
                        json={"pin": "0000"}, timeout=30)
        # Should be 401 (or 429 if locked out). Either is acceptable for "wrong PIN"
        assert r.status_code in (401, 429), r.text

    def test_admin_orders_lists_pickup_with_empty_address(self, client, product):
        # Login
        r = client.post(f"{BASE_URL}/api/admin/login",
                        json={"pin": "2937"}, timeout=30)
        assert r.status_code == 200
        token = r.json()["access_token"]
        # Fetch admin orders and assert at least one pickup
        r2 = client.get(f"{BASE_URL}/api/admin/orders",
                        headers={"Authorization": f"Bearer {token}"}, timeout=30)
        assert r2.status_code == 200
        orders = r2.json()
        pickups = [o for o in orders if o.get("delivery_mode") == "pickup"]
        assert len(pickups) >= 1, "Expected at least one pickup order created by TestDeliveryMode"
        for o in pickups:
            assert o["address"] == ""

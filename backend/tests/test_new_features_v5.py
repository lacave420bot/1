"""Iteration 5 — new features regression tests.

Coverage:
- Product fields: stock_unit, original_price, initial_stock_grams (auto-set)
- Shop hours: delivery_disabled_today flag + toggle round-trip
- Order creation: delivery rejected when delivery_disabled today; pickup accepted
- Variant label parsing (variant_grams) via non-gram units (legacy 'X g' + '1 L', '5 unités', '0.5 L')
- Categories & products reorder persistence
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://order-basket-5.preview.emergentagent.com").rstrip("/")
ADMIN_PIN = os.environ.get("ADMIN_PIN", "2937")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/admin/login", json={"pin": ADMIN_PIN}, timeout=10)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


def _today_weekday_name():
    import datetime
    days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    return days[datetime.datetime.now().weekday()]


# ---------------------------------------------------------------- Products
class TestProductFields:
    def test_create_product_persists_new_fields(self, admin_headers):
        payload = {
            "name": "TEST_StockUnitProduct",
            "description": "test",
            "price": 12.0,
            "image": "https://example.com/x.jpg",
            "category_id": "fleurs",
            "category_kind": "cbd",
            "stock_unit": "ml",
            "original_price": 18.0,
            "total_stock_grams": 250.0,
            "variants": [{"label": "10 ml", "price": 12.0}],
        }
        r = requests.post(f"{BASE_URL}/api/admin/products", json=payload, headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        pid = data["id"]
        assert data["stock_unit"] == "ml"
        assert data["original_price"] == 18.0
        assert data["initial_stock_grams"] == 250.0, f"initial_stock_grams should auto-set on create, got {data}"
        # GET roundtrip
        g = requests.get(f"{BASE_URL}/api/products/{pid}", timeout=10).json()
        assert g["stock_unit"] == "ml" and g["initial_stock_grams"] == 250.0
        # cleanup
        requests.delete(f"{BASE_URL}/api/admin/products/{pid}", headers=admin_headers, timeout=10)

    def test_patch_product_updates_initial_stock(self, admin_headers):
        create = {
            "name": "TEST_Patch", "description": "x", "price": 5.0,
            "image": "https://example.com/x.jpg", "category_id": "fleurs", "category_kind": "cbd",
            "total_stock_grams": 100.0, "stock_unit": "g",
        }
        c = requests.post(f"{BASE_URL}/api/admin/products", json=create, headers=admin_headers, timeout=10)
        assert c.status_code == 200, c.text
        created = c.json()
        pid = created["id"]
        assert created["initial_stock_grams"] == 100.0
        # Restock via PATCH — initial should reset to new total
        u = requests.patch(f"{BASE_URL}/api/admin/products/{pid}",
                           json={"total_stock_grams": 500.0, "original_price": 9.99},
                           headers=admin_headers, timeout=10)
        assert u.status_code == 200, u.text
        d = u.json()
        assert d["total_stock_grams"] == 500.0
        assert d["initial_stock_grams"] == 500.0
        assert d["original_price"] == 9.99
        requests.delete(f"{BASE_URL}/api/admin/products/{pid}", headers=admin_headers, timeout=10)

    def test_stock_unit_defaults_to_g(self, admin_headers):
        """When stock_unit is omitted, server should fall back to 'g' (per Product model default).

        Currently FAILS with 500 because ProductIn.stock_unit defaults to None,
        which then violates Product.stock_unit: str = 'g' (non-Optional).
        """
        create = {
            "name": "TEST_Default", "description": "x", "price": 5.0,
            "image": "https://example.com/x.jpg", "category_id": "fleurs", "category_kind": "cbd",
        }
        c = requests.post(f"{BASE_URL}/api/admin/products", json=create, headers=admin_headers, timeout=10)
        assert c.status_code == 200, f"BUG: POST without stock_unit should default to 'g' but got {c.status_code}: {c.text}"
        data = c.json()
        assert data["stock_unit"] == "g"
        requests.delete(f"{BASE_URL}/api/admin/products/{data['id']}", headers=admin_headers, timeout=10)


# ---------------------------------------------------------------- Variant label parsing
class TestVariantParsing:
    """Verify shared gram-stock decrement uses variant_grams() on non-gram labels."""

    def test_litre_label_decrements_shared_stock(self, admin_headers):
        create = {
            "name": "TEST_LitreProduct", "description": "x",
            "price": 10.0, "image": "https://example.com/x.jpg",
            "category_id": "huiles", "category_kind": "cbd",
            "total_stock_grams": 10.0,
            "stock_unit": "L",
            "variants": [
                {"label": "1 L", "price": 10.0},
                {"label": "0.5 L", "price": 6.0},
            ],
        }
        c = requests.post(f"{BASE_URL}/api/admin/products", json=create, headers=admin_headers, timeout=10)
        assert c.status_code == 200, c.text
        pid = c.json()["id"]

        order = {
            "guest_id": "TEST_v5_litre",
            "customer_name": "Tester",
            "phone": "0600000000",
            "delivery_mode": "pickup",
            "items": [
                {"product_id": pid, "quantity": 2, "variant_label": "1 L"},
                {"product_id": pid, "quantity": 1, "variant_label": "0.5 L"},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/orders", json=order, timeout=10)
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/api/products/{pid}", timeout=10).json()
        assert abs(g["total_stock_grams"] - 7.5) < 1e-3, g

        requests.delete(f"{BASE_URL}/api/admin/products/{pid}", headers=admin_headers, timeout=10)

    def test_unites_label_decrements_shared_stock(self, admin_headers):
        create = {
            "name": "TEST_UnitesProduct", "description": "x",
            "price": 4.0, "image": "https://example.com/x.jpg",
            "category_id": "accessoires", "category_kind": "cbd",
            "total_stock_grams": 30.0, "stock_unit": "unité",
            "variants": [{"label": "5 unités", "price": 4.0}],
        }
        c = requests.post(f"{BASE_URL}/api/admin/products", json=create, headers=admin_headers, timeout=10)
        assert c.status_code == 200, c.text
        pid = c.json()["id"]

        order = {
            "guest_id": "TEST_v5_unit",
            "customer_name": "Tester",
            "phone": "0600000000",
            "delivery_mode": "pickup",
            "items": [{"product_id": pid, "quantity": 2, "variant_label": "5 unités"}],
        }
        r = requests.post(f"{BASE_URL}/api/orders", json=order, timeout=10)
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/api/products/{pid}", timeout=10).json()
        assert abs(g["total_stock_grams"] - 20.0) < 1e-3, g

        requests.delete(f"{BASE_URL}/api/admin/products/{pid}", headers=admin_headers, timeout=10)

    def test_legacy_g_label_still_parses(self, admin_headers):
        create = {
            "name": "TEST_LegacyGram", "description": "x",
            "price": 9.0, "image": "https://example.com/x.jpg",
            "category_id": "fleurs", "category_kind": "cbd",
            "total_stock_grams": 50.0, "stock_unit": "g",
            "variants": [{"label": "5 g", "price": 40.0}],
        }
        c = requests.post(f"{BASE_URL}/api/admin/products", json=create, headers=admin_headers, timeout=10)
        assert c.status_code == 200, c.text
        pid = c.json()["id"]

        order = {
            "guest_id": "TEST_v5_g",
            "customer_name": "Tester",
            "phone": "0600000000",
            "delivery_mode": "pickup",
            "items": [{"product_id": pid, "quantity": 3, "variant_label": "5 g"}],
        }
        r = requests.post(f"{BASE_URL}/api/orders", json=order, timeout=10)
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/api/products/{pid}", timeout=10).json()
        assert abs(g["total_stock_grams"] - 35.0) < 1e-3, g

        requests.delete(f"{BASE_URL}/api/admin/products/{pid}", headers=admin_headers, timeout=10)


# ---------------------------------------------------------------- Shop hours: delivery_disabled_today
class TestShopHoursDeliveryDisabled:
    def _save_hours_with_toggle(self, headers, today_name, disabled):
        # Build the full hours payload; preserve other days unchanged from current
        current = requests.get(f"{BASE_URL}/api/shop/hours", timeout=10).json()
        hours = dict(current.get("hours") or {})
        for d in ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]:
            day = dict(hours.get(d) or {"open": "10:00", "close": "19:00"})
            # Ensure required fields present
            if "open" not in day:
                day["open"] = "10:00"
            if "close" not in day:
                day["close"] = "19:00"
            day["delivery_disabled"] = bool(day.get("delivery_disabled"))
            hours[d] = day
        hours[today_name]["delivery_disabled"] = disabled
        r = requests.put(f"{BASE_URL}/api/admin/shop/hours", json={"hours": hours}, headers=headers, timeout=10)
        assert r.status_code == 200, r.text
        return r

    def test_get_shop_hours_exposes_flag(self):
        r = requests.get(f"{BASE_URL}/api/shop/hours", timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "delivery_disabled_today" in body
        assert isinstance(body["delivery_disabled_today"], bool)
        assert "delivery_disabled_today" in body.get("status", {})

    def test_toggle_round_trip(self, admin_headers):
        today = _today_weekday_name()
        initial = requests.get(f"{BASE_URL}/api/shop/hours", timeout=10).json()
        initial_flag = bool(initial.get("delivery_disabled_today"))
        try:
            # Flip ON
            self._save_hours_with_toggle(admin_headers, today, True)
            after_on = requests.get(f"{BASE_URL}/api/shop/hours", timeout=10).json()
            assert after_on["delivery_disabled_today"] is True
            # Flip OFF
            self._save_hours_with_toggle(admin_headers, today, False)
            after_off = requests.get(f"{BASE_URL}/api/shop/hours", timeout=10).json()
            assert after_off["delivery_disabled_today"] is False
        finally:
            # Restore original state
            self._save_hours_with_toggle(admin_headers, today, initial_flag)


# ---------------------------------------------------------------- Order creation with delivery_disabled
class TestDeliveryBlocked:
    def test_delivery_rejected_when_disabled_pickup_accepted(self, admin_headers):
        today = _today_weekday_name()
        # Use seeded product (Amnesia Haze Greenhouse exists per agent context)
        prods = requests.get(f"{BASE_URL}/api/products", timeout=10).json()
        target = next((p for p in prods if p["name"] == "Amnesia Haze Greenhouse"), prods[0])
        variant_label = target["variants"][0]["label"] if target.get("variants") else None

        # Save initial flag and flip ON
        cur = requests.get(f"{BASE_URL}/api/shop/hours", timeout=10).json()
        initial_hours = cur["hours"]
        hours = {d: {**(initial_hours.get(d) or {"open": "10:00", "close": "19:00"}),
                     "delivery_disabled": bool((initial_hours.get(d) or {}).get("delivery_disabled"))}
                 for d in ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]}
        # ensure open/close
        for d in hours:
            hours[d].setdefault("open", "10:00")
            hours[d].setdefault("close", "19:00")
        original_today = bool(hours[today].get("delivery_disabled"))
        hours[today]["delivery_disabled"] = True
        r = requests.put(f"{BASE_URL}/api/admin/shop/hours", json={"hours": hours}, headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text

        try:
            # Delivery should fail with 400
            delivery_order = {
                "guest_id": "TEST_v5_blocked",
                "customer_name": "Tester",
                "phone": "0600000000",
                "address": "1 rue de Test, Paris",
                "delivery_mode": "delivery",
                "items": [{"product_id": target["id"], "quantity": 1, "variant_label": variant_label}],
            }
            d = requests.post(f"{BASE_URL}/api/orders", json=delivery_order, timeout=10)
            assert d.status_code == 400, f"expected 400 got {d.status_code}: {d.text}"
            assert "livraison" in d.text.lower()

            # Pickup should succeed
            pickup_order = {**delivery_order, "delivery_mode": "pickup", "address": ""}
            p = requests.post(f"{BASE_URL}/api/orders", json=pickup_order, timeout=10)
            assert p.status_code == 200, p.text
            assert p.json()["delivery_mode"] == "pickup"
        finally:
            hours[today]["delivery_disabled"] = original_today
            requests.put(f"{BASE_URL}/api/admin/shop/hours", json={"hours": hours}, headers=admin_headers, timeout=10)


# ---------------------------------------------------------------- Reorder endpoints
class TestReorder:
    def test_reorder_categories_persists(self, admin_headers):
        cats = requests.get(f"{BASE_URL}/api/categories", timeout=10).json()
        ids = [c["id"] for c in cats]
        assert len(ids) >= 2

        # Reverse
        reversed_ids = list(reversed(ids))
        r = requests.put(f"{BASE_URL}/api/admin/categories/reorder", json={"ids": reversed_ids},
                         headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("count") == len(reversed_ids)

        # Verify GET returns in new order (sort_order)
        new_cats = requests.get(f"{BASE_URL}/api/categories", timeout=10).json()
        new_ids = [c["id"] for c in new_cats]
        assert new_ids == reversed_ids, f"expected {reversed_ids}, got {new_ids}"

        # Restore
        rr = requests.put(f"{BASE_URL}/api/admin/categories/reorder", json={"ids": ids},
                         headers=admin_headers, timeout=10)
        assert rr.status_code == 200

    def test_reorder_products_persists(self, admin_headers):
        # Restrict to one category to keep payload small but meaningful
        prods = requests.get(f"{BASE_URL}/api/products?category_id=fleurs", timeout=10).json()
        ids = [p["id"] for p in prods]
        if len(ids) < 2:
            pytest.skip("not enough products in 'fleurs' to reorder")

        # Get FULL list to send (endpoint expects whole ordered list of any subset)
        all_prods = requests.get(f"{BASE_URL}/api/products", timeout=10).json()
        all_ids = [p["id"] for p in all_prods]
        # Move first 'fleurs' product to the end
        first_pid = ids[0]
        new_order = [p for p in all_ids if p != first_pid] + [first_pid]
        r = requests.put(f"{BASE_URL}/api/admin/products/reorder", json={"ids": new_order},
                         headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text

        after = requests.get(f"{BASE_URL}/api/products", timeout=10).json()
        after_ids = [p["id"] for p in after]
        # The moved product should now be the last
        assert after_ids[-1] == first_pid, f"expected {first_pid} at end, got {after_ids[-3:]}"

        # Restore original order
        rr = requests.put(f"{BASE_URL}/api/admin/products/reorder", json={"ids": all_ids},
                         headers=admin_headers, timeout=10)
        assert rr.status_code == 200

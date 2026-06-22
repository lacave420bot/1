"""Tests for iteration 4: admin orders DELETE / bulk-delete + evaluate_promo 'fixed' alias."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://order-basket-5.preview.emergentagent.com").rstrip("/")
ADMIN_PIN = "2937"


# --------- helpers / fixtures ---------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(session):
    r = session.post(f"{BASE_URL}/api/admin/login", json={"pin": ADMIN_PIN})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


def _create_order(session) -> str:
    """Create a real order via public API and return its id."""
    products = session.get(f"{BASE_URL}/api/products").json()
    pid = products[0]["id"]
    variant = (products[0].get("variants") or [{"label": None}])[0].get("label")
    body = {
        "guest_id": "TEST_v4_admin_orders",
        "customer_name": "TEST v4",
        "address": "",
        "phone": "0600000000",
        "notes": "TEST v4 — to be deleted",
        "delivery_mode": "pickup",
        "items": [{"product_id": pid, "quantity": 1, **({"variant_label": variant} if variant else {})}],
    }
    r = session.post(f"{BASE_URL}/api/orders", json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# --------- DELETE /api/admin/orders/{id} ---------
class TestAdminDeleteOrder:
    def test_delete_requires_auth(self, session):
        r = session.delete(f"{BASE_URL}/api/admin/orders/anything-here")
        assert r.status_code == 401

    def test_delete_existing_order(self, session, auth_headers):
        order_id = _create_order(session)

        r = session.delete(f"{BASE_URL}/api/admin/orders/{order_id}", headers=auth_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("status") == "ok"
        assert body.get("deleted") == 1

        # Verify it's actually gone
        r2 = session.get(f"{BASE_URL}/api/orders/{order_id}")
        assert r2.status_code == 404

    def test_delete_unknown_returns_404(self, session, auth_headers):
        r = session.delete(f"{BASE_URL}/api/admin/orders/does-not-exist-xyz", headers=auth_headers)
        assert r.status_code == 404


# --------- POST /api/admin/orders/bulk-delete ---------
class TestAdminBulkDeleteOrders:
    def test_bulk_requires_auth(self, session):
        r = session.post(f"{BASE_URL}/api/admin/orders/bulk-delete", json={"ids": []})
        assert r.status_code == 401

    def test_bulk_empty_array(self, session, auth_headers):
        r = session.post(f"{BASE_URL}/api/admin/orders/bulk-delete", json={"ids": []}, headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "ok"
        assert data.get("deleted") == 0

    def test_bulk_delete_three_orders(self, session, auth_headers):
        ids = [_create_order(session) for _ in range(3)]
        r = session.post(
            f"{BASE_URL}/api/admin/orders/bulk-delete",
            json={"ids": ids},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("status") == "ok"
        assert data.get("deleted") == 3

        # All gone
        for oid in ids:
            assert session.get(f"{BASE_URL}/api/orders/{oid}").status_code == 404

    def test_bulk_delete_mixed_existing_and_unknown(self, session, auth_headers):
        existing = _create_order(session)
        r = session.post(
            f"{BASE_URL}/api/admin/orders/bulk-delete",
            json={"ids": [existing, "ghost-id-zzz"]},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json().get("deleted") == 1


# --------- evaluate_promo 'fixed' alias ---------
class TestPromoFixedAlias:
    """Backend update: kind='fixed' should behave like kind='amount'."""

    PROMO_CODE = "TESTFIXED10"

    @pytest.fixture(autouse=True)
    def _cleanup(self, session, auth_headers):
        # cleanup before
        promos = session.get(f"{BASE_URL}/api/admin/promo-codes", headers=auth_headers).json()
        for p in promos:
            if p["code"] == self.PROMO_CODE:
                session.delete(f"{BASE_URL}/api/admin/promo-codes/{p['id']}", headers=auth_headers)
        yield
        # cleanup after
        promos = session.get(f"{BASE_URL}/api/admin/promo-codes", headers=auth_headers).json()
        for p in promos:
            if p["code"] == self.PROMO_CODE:
                session.delete(f"{BASE_URL}/api/admin/promo-codes/{p['id']}", headers=auth_headers)

    def test_fixed_kind_is_aliased_to_amount(self, session, auth_headers):
        # The admin POST validator only accepts {percent, amount, amount_min}, so we
        # must inject the 'fixed' kind directly into MongoDB to exercise the alias path.
        from pymongo import MongoClient
        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "test_database")
        cli = MongoClient(mongo_url)
        db = cli[db_name]
        import uuid
        from datetime import datetime, timezone
        db.promo_codes.insert_one({
            "id": str(uuid.uuid4()),
            "code": self.PROMO_CODE,
            "kind": "fixed",
            "value": 10.0,
            "min_subtotal": 0.0,
            "max_uses": None,
            "times_used": 0,
            "expires_at": None,
            "enabled": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

        try:
            # Validate with subtotal 50 → expect discount 10
            r = session.post(
                f"{BASE_URL}/api/promo/validate",
                json={"code": self.PROMO_CODE, "subtotal": 50.0},
            )
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["valid"] is True, f"Expected valid=True, got: {data}"
            assert data["discount"] == 10.0
            assert data["kind"] == "fixed"
            assert data.get("error") is None

            # Subtotal below value → discount capped at subtotal
            r2 = session.post(
                f"{BASE_URL}/api/promo/validate",
                json={"code": self.PROMO_CODE, "subtotal": 4.0},
            )
            assert r2.status_code == 200
            d2 = r2.json()
            assert d2["valid"] is True
            assert d2["discount"] == 4.0
        finally:
            db.promo_codes.delete_one({"code": self.PROMO_CODE})
            cli.close()

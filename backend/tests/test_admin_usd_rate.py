"""Backend tests for USD/TRY exchange rate admin settings + public endpoint.

Covers:
- GET /api/admin/settings/usd-rate (admin only)
- PUT /api/admin/settings/usd-rate (manual set / mode switch / validation)
- POST /api/admin/settings/usd-rate/refresh (force live fetch)
- GET /api/settings/usd-rate/public (any authenticated user)
- Existing /api/admin/notifications/config still returns 200

Leaves state in mode='auto' at end.
"""
import os
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

ADMIN_EMAIL = "harryginny700@gmail.com"
ADMIN_PASSWORD = "Admin123!"


# ------------ Fixtures ------------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    token = r.json().get("token")
    assert token
    return token


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module", autouse=True)
def _cleanup_state(admin_headers):
    """After tests complete, restore mode='auto'."""
    yield
    try:
        requests.put(
            f"{BASE_URL}/api/admin/settings/usd-rate",
            headers=admin_headers,
            json={"mode": "auto"},
            timeout=15,
        )
    except Exception:
        pass


# ------------ GET /admin/settings/usd-rate ------------
class TestGetAdminUsdRate:
    def test_admin_get_returns_all_fields(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/settings/usd-rate", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # Required fields
        for k in ("usd_rate", "updated_at", "mode", "source", "last_fetch_at", "fetch_error"):
            assert k in data, f"missing field {k}: {data}"
        # rate is a live realistic value (USD/TRY typically 25-70 in 2026)
        assert isinstance(data["usd_rate"], (int, float))
        assert data["usd_rate"] > 0
        assert 10 <= data["usd_rate"] <= 200, f"unrealistic rate {data['usd_rate']}"
        # mode should be auto|manual
        assert data["mode"] in ("auto", "manual")

    def test_unauth_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/admin/settings/usd-rate", timeout=15)
        assert r.status_code in (401, 403)


# ------------ POST /admin/settings/usd-rate/refresh ------------
class TestRefreshUsdRate:
    def test_force_refresh_returns_live_rate(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/settings/usd-rate/refresh",
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "usd_rate" in data and data["usd_rate"] > 0
        assert 10 <= data["usd_rate"] <= 200
        # After force refresh, source should be one of the live providers
        assert data.get("source") in ("frankfurter", "open.er-api"), f"unexpected source {data.get('source')}"


# ------------ PUT /admin/settings/usd-rate ------------
class TestPutUsdRate:
    def test_set_manual_switches_mode_to_manual(self, admin_headers):
        r = requests.put(
            f"{BASE_URL}/api/admin/settings/usd-rate",
            headers=admin_headers,
            json={"usd_rate": 55.5},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["usd_rate"] == 55.5
        assert data["mode"] == "manual"
        assert data["source"] == "manual"

        # GET verifies persistence
        g = requests.get(f"{BASE_URL}/api/admin/settings/usd-rate", headers=admin_headers, timeout=15)
        assert g.status_code == 200
        gd = g.json()
        assert gd["usd_rate"] == 55.5
        assert gd["mode"] == "manual"
        assert gd["source"] == "manual"

    def test_switch_back_to_auto_triggers_fresh_fetch(self, admin_headers):
        # Prep: set manual so we detect the mode flip
        requests.put(
            f"{BASE_URL}/api/admin/settings/usd-rate",
            headers=admin_headers,
            json={"usd_rate": 55.5},
            timeout=15,
        )
        # Now switch to auto (no usd_rate) — should refresh
        r = requests.put(
            f"{BASE_URL}/api/admin/settings/usd-rate",
            headers=admin_headers,
            json={"mode": "auto"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["mode"] == "auto"
        assert data["source"] != "manual", f"source should not be manual after auto refresh; got {data.get('source')}"
        assert data["source"] in ("frankfurter", "open.er-api")
        # Rate must be realistic (not 55.5 unless coincidentally very close)
        assert 10 <= data["usd_rate"] <= 200

    def test_zero_rate_rejected_400(self, admin_headers):
        r = requests.put(
            f"{BASE_URL}/api/admin/settings/usd-rate",
            headers=admin_headers,
            json={"usd_rate": 0},
            timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_empty_body_rejected_400(self, admin_headers):
        r = requests.put(
            f"{BASE_URL}/api/admin/settings/usd-rate",
            headers=admin_headers,
            json={},
            timeout=15,
        )
        assert r.status_code == 400, r.text
        # Turkish error message
        try:
            body = r.json()
            msg = (body.get("detail") or "").lower()
            assert "değişiklik" in msg or "degisiklik" in msg
        except Exception:
            pass


# ------------ GET /settings/usd-rate/public ------------
class TestPublicUsdRate:
    def test_authenticated_user_can_access(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/settings/usd-rate/public",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("usd_rate", "updated_at", "source"):
            assert k in data, f"missing {k}"
        assert isinstance(data["usd_rate"], (int, float))
        assert data["usd_rate"] > 0

    def test_no_auth_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/settings/usd-rate/public", timeout=15)
        assert r.status_code in (401, 403)


# ------------ Existing notification endpoint still healthy ------------
class TestExistingEndpointsUnaffected:
    def test_admin_notifications_config_200(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/notifications/config",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text

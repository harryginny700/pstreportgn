"""
Playspintech Multi-Tenant Backend Tests
Covers:
- Admin auth (login, /auth/me)
- Sites (CRUD, seed-defaults)
- Users (CRUD, uniqueness, RBAC)
- Cross-site isolation for site users
- Admin override via ?site_id=
- Cascade delete on site removal
- Admin self-delete guard
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
# fallback: use frontend .env
if not BASE_URL:
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL"):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")

API = f"{BASE_URL}/api"

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "harryginny700@gmail.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin123!")

# --------- Session-scoped state carried between tests ---------
STATE = {}


def _auth_hdr(token):
    return {"Authorization": f"Bearer {token}"}


# ========== AUTH ==========

class TestAuth:
    def test_login_admin_success(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 20
        assert data["user"]["email"].lower() == ADMIN_EMAIL.lower()
        assert data["user"]["platform_role"] == "admin"
        assert "password_hash" not in data["user"]
        STATE["admin_token"] = data["token"]
        STATE["admin_user_id"] = data["user"]["id"]

    def test_login_invalid_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrongpass"})
        assert r.status_code == 401

    def test_me_with_token(self):
        assert STATE.get("admin_token"), "requires login first"
        r = requests.get(f"{API}/auth/me", headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["email"].lower() == ADMIN_EMAIL.lower()
        assert data["user"]["platform_role"] == "admin"

    def test_me_without_token(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_invalid_token(self):
        r = requests.get(f"{API}/auth/me", headers=_auth_hdr("invalid.token.here"))
        assert r.status_code == 401


# ========== ADMIN SITES ==========

class TestAdminSites:
    def test_list_sites_returns_etobahis(self):
        r = requests.get(f"{API}/admin/sites", headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 200, r.text
        sites = r.json()
        assert isinstance(sites, list)
        names = [s["name"] for s in sites]
        assert "Etobahis" in names, f"Etobahis not in {names}"
        eto = next(s for s in sites if s["name"] == "Etobahis")
        assert "user_count" in eto
        assert "id" in eto
        STATE["etobahis_id"] = eto["id"]

    def test_create_new_site(self):
        payload = {"name": "TEST_TestSite", "slug": "test-testsite"}
        r = requests.post(f"{API}/admin/sites", json=payload, headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST_TestSite"
        assert "id" in data
        STATE["testsite_id"] = data["id"]

    def test_seed_defaults_for_new_site(self):
        sid = STATE["testsite_id"]
        r = requests.post(f"{API}/admin/sites/{sid}/seed-defaults", headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 200, r.text
        # verify counts
        cr = requests.get(f"{API}/cash-registers?site_id={sid}", headers=_auth_hdr(STATE["admin_token"]))
        assert cr.status_code == 200
        assert len(cr.json()) == 8, f"expected 8 kasalar, got {len(cr.json())}"
        pm = requests.get(f"{API}/payment-methods?site_id={sid}", headers=_auth_hdr(STATE["admin_token"]))
        assert len(pm.json()) == 11
        db = requests.get(f"{API}/debtors?site_id={sid}", headers=_auth_hdr(STATE["admin_token"]))
        assert len(db.json()) == 4

    def test_seed_defaults_fails_if_site_has_data(self):
        sid = STATE["testsite_id"]
        r = requests.post(f"{API}/admin/sites/{sid}/seed-defaults", headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 400


# ========== ADMIN USERS ==========

class TestAdminUsers:
    def test_create_site_user(self):
        payload = {
            "email": f"TEST_siteuser_{int(time.time())}@example.com",
            "password": "SitePass123!",
            "name": "TEST Site User",
            "site_id": STATE["testsite_id"],
            "site_role": "operator",
        }
        STATE["siteuser_email"] = payload["email"]
        STATE["siteuser_password"] = payload["password"]
        r = requests.post(f"{API}/admin/users", json=payload, headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["email"] == payload["email"].lower()
        assert data["site_id"] == STATE["testsite_id"]
        assert data["site_role"] == "operator"
        assert "password_hash" not in data
        STATE["siteuser_id"] = data["id"]

    def test_duplicate_email_returns_400(self):
        payload = {
            "email": STATE["siteuser_email"],
            "password": "AnotherPass1!",
            "site_id": STATE["testsite_id"],
        }
        r = requests.post(f"{API}/admin/users", json=payload, headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 400

    def test_site_user_login_returns_site_id(self):
        r = requests.post(f"{API}/auth/login", json={"email": STATE["siteuser_email"], "password": STATE["siteuser_password"]})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["site_id"] == STATE["testsite_id"]
        assert data["user"].get("platform_role") is None
        STATE["siteuser_token"] = data["token"]


# ========== TENANT ISOLATION ==========

class TestTenantIsolation:
    def test_site_user_sees_only_own_cash_registers(self):
        r = requests.get(f"{API}/cash-registers", headers=_auth_hdr(STATE["siteuser_token"]))
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) == 8
        for row in rows:
            assert row["site_id"] == STATE["testsite_id"], f"leaked site_id: {row['site_id']}"

    def test_site_user_cannot_see_etobahis_via_site_id_param(self):
        # site users' site_id param is IGNORED (they see their own only)
        r = requests.get(f"{API}/cash-registers?site_id={STATE['etobahis_id']}", headers=_auth_hdr(STATE["siteuser_token"]))
        assert r.status_code == 200
        for row in r.json():
            assert row["site_id"] == STATE["testsite_id"]

    def test_admin_sees_all_registers(self):
        r = requests.get(f"{API}/cash-registers", headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 200
        rows = r.json()
        sids = {row["site_id"] for row in rows}
        assert STATE["etobahis_id"] in sids
        assert STATE["testsite_id"] in sids

    def test_admin_filter_by_etobahis(self):
        r = requests.get(f"{API}/cash-registers?site_id={STATE['etobahis_id']}", headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 200
        for row in r.json():
            assert row["site_id"] == STATE["etobahis_id"]

    def test_site_user_cannot_mutate_etobahis_pm(self):
        # get an etobahis pm as admin
        r = requests.get(f"{API}/payment-methods?site_id={STATE['etobahis_id']}", headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 200
        pms = r.json()
        if not pms:
            pytest.skip("No Etobahis payment methods to test cross-site mutation against")
        eto_pm_id = pms[0]["id"]
        payload = {"name": "HACKED", "cash_register_id": None, "deposit_commission_pct": 0, "withdrawal_commission_pct": 0, "active": True}
        # site user tries PUT
        r = requests.put(f"{API}/payment-methods/{eto_pm_id}", json=payload, headers=_auth_hdr(STATE["siteuser_token"]))
        assert r.status_code == 404, f"expected 404 for cross-site put, got {r.status_code}"
        # site user tries DELETE
        r = requests.delete(f"{API}/payment-methods/{eto_pm_id}", headers=_auth_hdr(STATE["siteuser_token"]))
        # delete_one silently returns 200 even without match (no 404 check in code)
        assert r.status_code == 200
        # verify the etobahis pm is still there
        r = requests.get(f"{API}/payment-methods?site_id={STATE['etobahis_id']}", headers=_auth_hdr(STATE["admin_token"]))
        remaining = [p["id"] for p in r.json()]
        assert eto_pm_id in remaining, "Etobahis PM was deleted by site user - ISOLATION BREACH"


# ========== TRANSACTIONS ==========

class TestTransactions:
    def test_create_transaction_as_site_user_stamps_site_id(self):
        # get a payment method in the test site
        r = requests.get(f"{API}/payment-methods", headers=_auth_hdr(STATE["siteuser_token"]))
        assert r.status_code == 200
        pms = r.json()
        assert len(pms) > 0
        pm_id = pms[0]["id"]
        STATE["testsite_pm_id"] = pm_id

        payload = {"date": "2026-01-15", "payment_method_id": pm_id, "deposit": 1000.0, "withdrawal": 200.0, "note": "TEST_tx"}
        r = requests.post(f"{API}/transactions", json=payload, headers=_auth_hdr(STATE["siteuser_token"]))
        assert r.status_code == 200, r.text
        tx = r.json()
        assert tx["site_id"] == STATE["testsite_id"]
        assert tx["deposit"] == 1000.0
        STATE["tx_id"] = tx["id"]

    def test_admin_create_transaction_requires_site_id(self):
        payload = {"date": "2026-01-16", "payment_method_id": STATE["testsite_pm_id"], "deposit": 500.0, "withdrawal": 0.0}
        # without site_id
        r = requests.post(f"{API}/transactions", json=payload, headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 400, f"admin should be forced to pass site_id, got {r.status_code}"

    def test_admin_create_transaction_with_site_id(self):
        payload = {"date": "2026-01-16", "payment_method_id": STATE["testsite_pm_id"], "deposit": 500.0, "withdrawal": 0.0}
        r = requests.post(f"{API}/transactions?site_id={STATE['testsite_id']}", json=payload, headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 200, r.text
        tx = r.json()
        assert tx["site_id"] == STATE["testsite_id"]

    def test_transaction_wrong_pm_site_returns_404(self):
        # try to create a testsite tx with an etobahis pm as admin
        r = requests.get(f"{API}/payment-methods?site_id={STATE['etobahis_id']}", headers=_auth_hdr(STATE["admin_token"]))
        eto_pms = r.json()
        if not eto_pms:
            pytest.skip("no etobahis pms")
        payload = {"date": "2026-01-16", "payment_method_id": eto_pms[0]["id"], "deposit": 1.0, "withdrawal": 0.0}
        r = requests.post(f"{API}/transactions?site_id={STATE['testsite_id']}", json=payload, headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 404


# ========== DASHBOARD & OVERVIEW ==========

class TestDashboard:
    def test_site_user_dashboard_returns_own_site(self):
        r = requests.get(f"{API}/dashboard", headers=_auth_hdr(STATE["siteuser_token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["site"]["id"] == STATE["testsite_id"]
        assert "kpis" in d
        assert "balances" in d

    def test_admin_dashboard_no_site_id_falls_back(self):
        r = requests.get(f"{API}/dashboard", headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        # should be first site (Etobahis by created_at)
        assert d["site"] is not None
        assert d["site"]["id"] == STATE["etobahis_id"]

    def test_admin_dashboard_with_site_id_filter(self):
        r = requests.get(f"{API}/dashboard?site_id={STATE['testsite_id']}", headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 200
        assert r.json()["site"]["id"] == STATE["testsite_id"]

    def test_admin_overview(self):
        r = requests.get(f"{API}/admin/overview", headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "totals" in d
        assert "sites" in d
        assert d["totals"]["site_count"] >= 2
        site_names = [s["site_name"] for s in d["sites"]]
        assert "Etobahis" in site_names
        assert "TEST_TestSite" in site_names


# ========== RBAC ==========

class TestRBAC:
    def test_site_user_forbidden_from_admin_endpoints(self):
        for path in ["/admin/sites", "/admin/users", "/admin/overview"]:
            r = requests.get(f"{API}{path}", headers=_auth_hdr(STATE["siteuser_token"]))
            assert r.status_code == 403, f"{path} expected 403, got {r.status_code}"

    def test_admin_cannot_delete_self(self):
        r = requests.delete(f"{API}/admin/users/{STATE['admin_user_id']}", headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 400


# ========== CASCADE DELETE (cleanup) ==========

class TestCascadeDelete:
    def test_delete_site_cascades(self):
        sid = STATE["testsite_id"]
        # sanity: has data
        r = requests.get(f"{API}/cash-registers?site_id={sid}", headers=_auth_hdr(STATE["admin_token"]))
        assert len(r.json()) > 0
        # delete site
        r = requests.delete(f"{API}/admin/sites/{sid}", headers=_auth_hdr(STATE["admin_token"]))
        assert r.status_code == 200
        # verify all data gone
        for endpoint in ["cash-registers", "payment-methods", "debtors", "transactions", "credits", "expenses", "transfers"]:
            r = requests.get(f"{API}/{endpoint}?site_id={sid}", headers=_auth_hdr(STATE["admin_token"]))
            assert r.status_code == 200
            assert len(r.json()) == 0, f"{endpoint} not cleared after cascade"
        # verify user gone: login should now fail
        r = requests.post(f"{API}/auth/login", json={"email": STATE["siteuser_email"], "password": STATE["siteuser_password"]})
        assert r.status_code == 401
        # verify site not in list
        r = requests.get(f"{API}/admin/sites", headers=_auth_hdr(STATE["admin_token"]))
        ids = [s["id"] for s in r.json()]
        assert sid not in ids

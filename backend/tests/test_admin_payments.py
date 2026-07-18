"""
Backend tests for the new Admin Payments feature.

Endpoints under test (all admin-only):
- GET    /api/admin/payments
- POST   /api/admin/payments
- PUT    /api/admin/payments/{id}
- DELETE /api/admin/payments/{id}
- GET    /api/admin/payments/export.csv
- GET    /api/admin/payments/telegram-config
- PUT    /api/admin/payments/telegram-config
- GET    /api/admin/payments/telegram-preview
- POST   /api/admin/payments/send-telegram (only failure paths tested)
"""

import os
import csv
import io
import pytest
import requests
from datetime import date

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://gaming-ledger-pro.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")

ADMIN_EMAIL = "harryginny700@gmail.com"
ADMIN_PASSWORD = "Admin123!"


# --- Fixtures ---------------------------------------------------------------

@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD,
    }, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"no token in login response: {data}"
    return tok


@pytest.fixture(scope="module")
def admin_client(admin_token):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {admin_token}",
    })
    return s


@pytest.fixture(scope="module")
def date_range():
    today = date.today()
    start = today.replace(day=1).isoformat()
    # end of month - conservative: use a far-future day 28 or last day
    from calendar import monthrange
    _, last = monthrange(today.year, today.month)
    end = today.replace(day=last).isoformat()
    return start, end


# --- Auth guard -------------------------------------------------------------

class TestAdminAuthGuard:
    def test_unauthenticated_returns_401_or_403(self):
        r = requests.get(f"{BASE_URL}/api/admin/payments", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"


# --- CRUD -------------------------------------------------------------------

class TestAdminPaymentsCRUD:
    """Full create -> get -> update -> delete round-trip."""

    _created_ids: list = []

    def test_list_endpoint_ok(self, admin_client, date_range):
        df, dt = date_range
        r = admin_client.get(f"{BASE_URL}/api/admin/payments", params={"date_from": df, "date_to": dt}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and isinstance(data["items"], list)
        assert "total" in data and isinstance(data["total"], (int, float))
        assert "count" in data and isinstance(data["count"], int)

    def test_create_missing_description_400(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/admin/payments", json={
            "date": date.today().isoformat(),
            "description": "   ",  # blank after strip
            "amount": 100,
        }, timeout=15)
        # Server should reject blank description
        assert r.status_code in (400, 422), r.text

    def test_create_zero_amount_400(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/admin/payments", json={
            "date": date.today().isoformat(),
            "description": "TEST_zero",
            "amount": 0,
        }, timeout=15)
        assert r.status_code in (400, 422), r.text

    def test_create_negative_amount_400(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/admin/payments", json={
            "date": date.today().isoformat(),
            "description": "TEST_neg",
            "amount": -50,
        }, timeout=15)
        assert r.status_code in (400, 422), r.text

    def test_create_ok_and_persist(self, admin_client, date_range):
        payload = {
            "date": date.today().isoformat(),
            "description": "TEST_Kira Şubat",
            "amount": 25000,
            "category": "kira",
            "note": "test note",
        }
        r = admin_client.post(f"{BASE_URL}/api/admin/payments", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        created = r.json()
        assert "id" in created and isinstance(created["id"], str)
        assert created["description"] == "TEST_Kira Şubat"
        assert float(created["amount"]) == 25000.0
        assert created["category"] == "kira"
        assert created["note"] == "test note"
        assert created.get("created_by_email") == ADMIN_EMAIL
        TestAdminPaymentsCRUD._created_ids.append(created["id"])

        # GET verifies persistence
        df, dt = date_range
        lr = admin_client.get(f"{BASE_URL}/api/admin/payments", params={"date_from": df, "date_to": dt}, timeout=15)
        assert lr.status_code == 200
        items = lr.json()["items"]
        ids = [it["id"] for it in items]
        assert created["id"] in ids, "created payment not present in listing"

    def test_second_create_and_total_updates(self, admin_client, date_range):
        r = admin_client.post(f"{BASE_URL}/api/admin/payments", json={
            "date": date.today().isoformat(),
            "description": "TEST_Yazilim abonesi",
            "amount": 1200,
            "category": "yazilim",
        }, timeout=15)
        assert r.status_code == 200, r.text
        created = r.json()
        TestAdminPaymentsCRUD._created_ids.append(created["id"])

        df, dt = date_range
        lr = admin_client.get(f"{BASE_URL}/api/admin/payments", params={"date_from": df, "date_to": dt}, timeout=15)
        assert lr.status_code == 200
        data = lr.json()
        # total must include both TEST_ rows (there may be prior real data too, so we assert >=)
        assert data["total"] >= 26200.0
        assert data["count"] >= 2

    def test_update_ok(self, admin_client):
        pid = TestAdminPaymentsCRUD._created_ids[0]
        r = admin_client.put(f"{BASE_URL}/api/admin/payments/{pid}", json={
            "date": date.today().isoformat(),
            "description": "TEST_Kira Şubat (updated)",
            "amount": 27000,
            "category": "kira",
            "note": "updated",
        }, timeout=15)
        assert r.status_code == 200, r.text
        upd = r.json()
        assert float(upd["amount"]) == 27000.0
        assert upd["description"] == "TEST_Kira Şubat (updated)"

    def test_update_missing_id_404(self, admin_client):
        r = admin_client.put(f"{BASE_URL}/api/admin/payments/does-not-exist", json={
            "date": date.today().isoformat(),
            "description": "TEST_x",
            "amount": 10,
        }, timeout=15)
        assert r.status_code == 404

    def test_date_range_filter_excludes_far_past(self, admin_client):
        # 2020 range must contain no TEST_ records we just created (which are today)
        r = admin_client.get(f"{BASE_URL}/api/admin/payments", params={
            "date_from": "2020-01-01", "date_to": "2020-12-31"
        }, timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        ids = {it["id"] for it in items}
        for pid in TestAdminPaymentsCRUD._created_ids:
            assert pid not in ids, "range filter did not exclude today's records for 2020 window"

    def test_export_csv_ok(self, admin_client, date_range):
        df, dt = date_range
        r = admin_client.get(f"{BASE_URL}/api/admin/payments/export.csv", params={
            "date_from": df, "date_to": dt,
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert "text/csv" in r.headers.get("content-type", ""), r.headers
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd, cd
        text = r.text
        assert "Tarih,Açıklama,Kategori,Tutar (TRY),Not,Oluşturan" in text
        assert "TOPLAM" in text
        # parse CSV and check TEST_ rows present + totals row present
        rows = list(csv.reader(io.StringIO(text)))
        assert rows[0][0] == "Tarih"
        descs = [row[1] for row in rows[1:] if len(row) > 1]
        assert any("TEST_Kira" in d for d in descs)
        # TOPLAM row must be present
        assert any(row and row[0] == "TOPLAM" for row in rows)

    def test_delete_ok_and_gone(self, admin_client, date_range):
        for pid in TestAdminPaymentsCRUD._created_ids:
            dr = admin_client.delete(f"{BASE_URL}/api/admin/payments/{pid}", timeout=15)
            assert dr.status_code in (200, 204), f"{pid}: {dr.status_code} {dr.text}"
        # verify gone
        df, dt = date_range
        lr = admin_client.get(f"{BASE_URL}/api/admin/payments", params={"date_from": df, "date_to": dt}, timeout=15)
        assert lr.status_code == 200
        remaining = {it["id"] for it in lr.json()["items"]}
        for pid in TestAdminPaymentsCRUD._created_ids:
            assert pid not in remaining
        TestAdminPaymentsCRUD._created_ids.clear()

    def test_delete_missing_404(self, admin_client):
        dr = admin_client.delete(f"{BASE_URL}/api/admin/payments/nope-nope-nope", timeout=15)
        assert dr.status_code == 404


# --- Telegram config + preview + send failure -------------------------------

class TestAdminPaymentsTelegram:

    def test_get_config_ok(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/admin/payments/telegram-config", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "telegram_bot_token" in d
        assert "telegram_chat_id" in d
        assert "configured" in d

    def test_set_config_empty_marks_unconfigured(self, admin_client):
        r = admin_client.put(f"{BASE_URL}/api/admin/payments/telegram-config", json={
            "telegram_bot_token": "",
            "telegram_chat_id": "",
        }, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["configured"] is False

    def test_set_config_valid_looking_marks_configured(self, admin_client):
        r = admin_client.put(f"{BASE_URL}/api/admin/payments/telegram-config", json={
            "telegram_bot_token": "1234567:TEST_FAKE_TOKEN_ABC",
            "telegram_chat_id": "-1001234567890",
        }, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["configured"] is True
        assert d["telegram_bot_token"] == "1234567:TEST_FAKE_TOKEN_ABC"
        assert d["telegram_chat_id"] == "-1001234567890"

    def test_preview_message_contains_header(self, admin_client, date_range):
        df, dt = date_range
        r = admin_client.get(f"{BASE_URL}/api/admin/payments/telegram-preview", params={
            "date_from": df, "date_to": dt,
        }, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "message" in d
        assert "Playspintech Admin — Ödemeler" in d["message"]
        assert df in d["message"] and dt in d["message"]
        assert d["configured"] is True  # we set it in prior test

    def test_send_fails_when_config_empty(self, admin_client):
        # First reset config to empty
        r = admin_client.put(f"{BASE_URL}/api/admin/payments/telegram-config", json={
            "telegram_bot_token": "",
            "telegram_chat_id": "",
        }, timeout=15)
        assert r.status_code == 200
        # Now sending should 400
        sr = admin_client.post(f"{BASE_URL}/api/admin/payments/send-telegram", timeout=15)
        assert sr.status_code == 400, sr.text

    def test_send_fails_with_bad_token(self, admin_client):
        # set fake token/chat, send should 502 (Telegram API rejects)
        r = admin_client.put(f"{BASE_URL}/api/admin/payments/telegram-config", json={
            "telegram_bot_token": "1234567:TEST_FAKE_TOKEN_ABC",
            "telegram_chat_id": "-1001234567890",
        }, timeout=15)
        assert r.status_code == 200
        sr = admin_client.post(f"{BASE_URL}/api/admin/payments/send-telegram", timeout=30)
        # Telegram rejects invalid token → server should return 502 (or maybe 400 depending on Telegram response)
        assert sr.status_code in (400, 502), f"unexpected status {sr.status_code}: {sr.text}"

    def test_cleanup_config_empty(self, admin_client):
        # tidy up: leave config empty
        r = admin_client.put(f"{BASE_URL}/api/admin/payments/telegram-config", json={
            "telegram_bot_token": "",
            "telegram_chat_id": "",
        }, timeout=15)
        assert r.status_code == 200

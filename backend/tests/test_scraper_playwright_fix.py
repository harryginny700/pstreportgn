"""Tests for the Playwright/Chromium bug-fix on the admin scraper endpoints.

Verifies:
- test-connection actually launches Playwright (no 'Executable doesn't exist' error)
- debug screenshot endpoint serves PNG, requires auth, blocks path traversal
- backfill input validation + short (1-day) real run works without launch errors
- existing list/get/put endpoints unaffected

Cleans up: restores scraper config for the test site (enabled=false, empty user,
unset password_enc) at end of test class.
"""
from __future__ import annotations
import os
import time
import pytest
import requests
from datetime import date, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to frontend/.env
    from dotenv import dotenv_values
    v = dotenv_values("/app/frontend/.env")
    BASE_URL = (v.get("REACT_APP_BACKEND_URL") or "").rstrip("/")

ADMIN_EMAIL = "harryginny700@gmail.com"
ADMIN_PASSWORD = "Admin123!"

FAKE_USER = "testuser_wrong"
FAKE_PASS = "wrongpass_123"

# Etobahis site — has full config incl. mappings + base_url
TEST_SITE_ID = "6834390b-7c30-487f-8037-3888b557f6d6"


# ---- shared fixtures ----

@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def original_cfg(client):
    """Snapshot the scraper config so we can restore/cleanup afterwards."""
    r = client.get(f"{BASE_URL}/api/admin/scraper/{TEST_SITE_ID}", timeout=30)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module", autouse=True)
def _set_fake_and_cleanup(client, original_cfg):
    """Save fake credentials, run tests, cleanup at end (task requirement)."""
    # save fake creds
    r = client.put(
        f"{BASE_URL}/api/admin/scraper/{TEST_SITE_ID}",
        json={"username": FAKE_USER, "password": FAKE_PASS, "enabled": False},
        timeout=30,
    )
    assert r.status_code == 200, f"put fake creds failed: {r.text}"
    yield
    # Cleanup — direct DB scrub per task instructions
    try:
        from pymongo import MongoClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        c = MongoClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        db.scraper_configs.update_one(
            {"site_id": TEST_SITE_ID},
            {"$set": {"enabled": False, "username": ""},
             "$unset": {"password_enc": ""}},
        )
    except Exception as e:
        print(f"cleanup warn: {e}")


# ---- Existing endpoints still work ----

class TestExistingEndpoints:
    def test_list_scraper_configs(self, client):
        r = client.get(f"{BASE_URL}/api/admin/scraper", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert any(x.get("site_id") == TEST_SITE_ID for x in data)

    def test_get_scraper_config(self, client):
        r = client.get(f"{BASE_URL}/api/admin/scraper/{TEST_SITE_ID}", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("site_id") == TEST_SITE_ID
        assert d.get("username") == FAKE_USER  # our fake creds saved

    def test_put_scraper_config_toggle(self, client):
        r = client.put(
            f"{BASE_URL}/api/admin/scraper/{TEST_SITE_ID}",
            json={"enabled": False},
            timeout=30,
        )
        assert r.status_code == 200
        assert r.json().get("enabled") is False


# ---- Bug fix: test-connection launches Playwright ----

class TestTestConnection:
    def test_launch_ok_with_fake_creds(self, client):
        """The main bug fix — with fake creds we should get ok=false with the LOGIN
        failure message, not the 'Tarayıcı başlatılamadı: Executable doesn't exist' error."""
        r = client.post(
            f"{BASE_URL}/api/admin/scraper/{TEST_SITE_ID}/test-connection",
            timeout=180,
        )
        assert r.status_code == 200, f"unexpected status {r.status_code}: {r.text}"
        data = r.json()
        print("test-connection result:", data)
        assert data.get("ok") is False, f"expected ok=false, got: {data}"
        msg = (data.get("message") or "")
        # Must NOT be a browser-launch failure
        assert "Executable doesn" not in msg, f"BROWSER LAUNCH BUG PRESENT: {msg}"
        assert "Tarayıcı başlatılamadı" not in msg, f"BROWSER LAUNCH BUG PRESENT: {msg}"
        # Should be the login-failure message
        assert "Giriş başarısız" in msg, f"unexpected message: {msg}"
        # Debug screenshot should be captured (proves Playwright launched + navigated)
        assert data.get("debug_screenshot"), f"no debug_screenshot returned: {data}"
        assert data["debug_screenshot"].endswith(".png")

    def test_test_connection_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/scraper/{TEST_SITE_ID}/test-connection",
            timeout=30,
        )
        assert r.status_code in (401, 403), f"unauthenticated should fail, got {r.status_code}"


# ---- Debug screenshot endpoint ----

class TestDebugScreenshot:
    _captured_fname = {"v": None}

    @pytest.fixture(scope="class")
    def screenshot_filename(self, client):
        # Trigger a failed login to get a screenshot filename
        r = client.post(
            f"{BASE_URL}/api/admin/scraper/{TEST_SITE_ID}/test-connection",
            timeout=180,
        )
        assert r.status_code == 200
        fname = r.json().get("debug_screenshot")
        assert fname, "expected debug_screenshot from failed test-connection"
        return fname

    def test_serves_png(self, client, screenshot_filename):
        r = client.get(
            f"{BASE_URL}/api/admin/scraper/debug/{screenshot_filename}",
            timeout=30,
        )
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/png")
        assert len(r.content) > 100

    def test_requires_auth(self, screenshot_filename):
        r = requests.get(
            f"{BASE_URL}/api/admin/scraper/debug/{screenshot_filename}",
            timeout=30,
        )
        assert r.status_code in (401, 403)

    def test_rejects_non_png(self, client):
        r = client.get(f"{BASE_URL}/api/admin/scraper/debug/notpng.txt", timeout=30)
        assert r.status_code == 400

    def test_rejects_traversal(self, client):
        # requests will encode ../ but we send it as-is; server checks '..' substring
        r = client.get(f"{BASE_URL}/api/admin/scraper/debug/..%2F..%2Fetc%2Fpasswd", timeout=30)
        # Either rejected as 400 (name check) or 404 — must NOT return /etc/passwd content
        assert r.status_code in (400, 404)


# ---- Backfill validation + short run ----

class TestBackfill:
    def test_invalid_start_date(self, client):
        r = client.post(
            f"{BASE_URL}/api/admin/scraper/{TEST_SITE_ID}/backfill",
            json={"start_date": "not-a-date"},
            timeout=30,
        )
        assert r.status_code == 400
        assert "start_date" in (r.json().get("detail") or "")

    def test_end_before_start(self, client):
        r = client.post(
            f"{BASE_URL}/api/admin/scraper/{TEST_SITE_ID}/backfill",
            json={"start_date": "2026-01-10", "end_date": "2026-01-05"},
            timeout=30,
        )
        assert r.status_code == 400
        assert "end_date" in (r.json().get("detail") or "")

    def test_range_too_large(self, client):
        start = "2026-01-01"
        end = "2026-04-30"  # 120 days
        r = client.post(
            f"{BASE_URL}/api/admin/scraper/{TEST_SITE_ID}/backfill",
            json={"start_date": start, "end_date": end},
            timeout=30,
        )
        assert r.status_code == 400
        detail = r.json().get("detail") or ""
        assert "gün" in detail or "day" in detail.lower(), f"expected day count in error: {detail}"

    def test_one_day_range_launches_playwright(self, client):
        today = date.today().isoformat()
        # Backfill uses _run_scraper_for_site which short-circuits when disabled.
        # Temporarily enable to actually exercise Playwright launch.
        put = client.put(
            f"{BASE_URL}/api/admin/scraper/{TEST_SITE_ID}",
            json={"enabled": True},
            timeout=30,
        )
        assert put.status_code == 200
        try:
            r = client.post(
                f"{BASE_URL}/api/admin/scraper/{TEST_SITE_ID}/backfill",
                json={"start_date": today, "end_date": today},
                timeout=300,
            )
        finally:
            client.put(
                f"{BASE_URL}/api/admin/scraper/{TEST_SITE_ID}",
                json={"enabled": False},
                timeout=30,
            )
        assert r.status_code == 200, f"backfill failed: {r.status_code} {r.text}"
        data = r.json()
        print("backfill result:", data)
        assert data.get("days") == 1
        assert data.get("ok_count") == 0
        assert data.get("fail_count") == 1
        results = data.get("results") or []
        assert len(results) == 1
        r0 = results[0]
        assert r0.get("ok") is False
        err_str = (r0.get("error") or r0.get("message") or "")
        assert "Executable doesn" not in err_str, f"browser launch bug: {err_str}"
        assert "Giriş başarısız" in err_str, f"expected login-failure error, got: {r0}"
        # NEW: debug_screenshot should be present in per-day result even on failure
        assert r0.get("debug_screenshot"), f"expected debug_screenshot in backfill fail result: {r0}"
        assert r0["debug_screenshot"].endswith(".png")


# ---- New: Diagnostics + broader pagination code-level checks ----

class TestDiagnosticsCodeLevel:
    """Verify /app/backend/scraper.py and server.py surface diagnostics correctly.
    We can't do a real successful scrape (no real creds), so we assert at code
    level that the required keys exist and the plumbing wires them through.
    """

    def test_scraper_extract_returns_diagnostics_keys(self):
        import inspect, sys
        sys.path.insert(0, "/app/backend")
        import scraper as sc  # type: ignore
        src = inspect.getsource(sc._extract_table_rows)
        # Required diagnostic keys in the return value
        for key in ("total_seen", "newest_date", "oldest_date", "pages_visited", "rows"):
            assert f'"{key}"' in src, f"_extract_table_rows must return key {key!r}"
        # max_pages should be raised to 100
        assert "max_pages = 100" in src, "max_pages should be 100 (was 50)"
        # page-size dropdown helper is called
        assert "_try_set_page_size_100" in src

    def test_scrape_result_has_diagnostics_field(self):
        import sys
        sys.path.insert(0, "/app/backend")
        import scraper as sc  # type: ignore
        r = sc.ScrapeResult(ok=False, target_date="2026-01-01")
        assert hasattr(r, "diagnostics")
        assert isinstance(r.diagnostics, dict)
        assert hasattr(r, "debug_screenshot")

    def test_run_scraper_for_site_success_path_includes_diagnostics(self):
        import inspect
        # server.py path
        with open("/app/backend/server.py", "r") as f:
            src = f.read()
        # Find the success return block of _run_scraper_for_site
        # It should contain diagnostics + debug_screenshot in the summary dict AND the return payload
        assert '"diagnostics": result.diagnostics' in src, "summary dict must include diagnostics"
        assert '"debug_screenshot": result.debug_screenshot' in src, "summary dict must include debug_screenshot"
        # Return payload also spreads diagnostics + debug_screenshot on success
        assert '"diagnostics": result.diagnostics, "debug_screenshot": result.debug_screenshot' in src, (
            "success-path return payload must include both diagnostics and debug_screenshot")

    def test_navigate_and_extract_always_screenshots(self):
        import inspect, sys
        sys.path.insert(0, "/app/backend")
        import scraper as sc  # type: ignore
        src = inspect.getsource(sc._navigate_and_extract)
        assert 'await page.screenshot' in src
        assert '"screenshot"' in src


# ---- Iter 11: dynamic column detection ----

class TestDetectColumns:
    """Verify _detect_columns exists and _extract_table_rows uses `cols` dict
    (no hardcoded cells[2]..cells[9]) and returns headers/column_map/sample_rows."""

    def test_detect_columns_function_exists(self):
        import sys
        sys.path.insert(0, "/app/backend")
        import scraper as sc  # type: ignore
        assert hasattr(sc, "_detect_columns"), "_detect_columns must be defined"
        import inspect
        assert inspect.iscoroutinefunction(sc._detect_columns), (
            "_detect_columns must be an async function")

    def test_detect_columns_returns_expected_keys(self):
        import inspect, sys
        sys.path.insert(0, "/app/backend")
        import scraper as sc  # type: ignore
        src = inspect.getsource(sc._detect_columns)
        # Must return a dict with each logical column key
        for key in ("headers", "provider", "method", "tur", "status", "amount", "created"):
            assert f'"{key}"' in src, f"_detect_columns must map key {key!r}"
        # Reads THEAD headers
        assert "thead th" in src

    def test_extract_table_rows_uses_dynamic_cols(self):
        import inspect, sys
        sys.path.insert(0, "/app/backend")
        import scraper as sc  # type: ignore
        src = inspect.getsource(sc._extract_table_rows)
        # Must call _detect_columns
        assert "_detect_columns" in src, "must call _detect_columns"
        # Must use cols dict lookup, NOT hardcoded numeric cells[9]/[2] etc for the
        # provider/method/tur/status/amount/created columns
        for bad in ("cells[2]", "cells[3]", "cells[4]", "cells[5]", "cells[6]",
                    "cells[7]", "cells[8]", "cells[9]"):
            assert bad not in src, f"Hardcoded {bad} should be removed"
        # Must reference cols["provider"]/["method"]/etc.
        for key in ("provider", "method", "tur", "status", "amount", "created"):
            assert f'cols["{key}"]' in src or f"cols['{key}']" in src, (
                f"cols[{key!r}] must be used")

    def test_extract_returns_headers_column_map_sample_rows(self):
        import inspect, sys
        sys.path.insert(0, "/app/backend")
        import scraper as sc  # type: ignore
        src = inspect.getsource(sc._extract_table_rows)
        for key in ("headers", "column_map", "sample_rows"):
            assert f'"{key}"' in src, (
                f"_extract_table_rows must return key {key!r} in its dict")

    def test_frontend_renders_tablo_yapisi_debug_section(self):
        """AdminScraper.jsx should render <details><summary>Tablo yapısı</summary></details>
        with headers + column_map + sample_rows for successful days."""
        with open("/app/frontend/src/pages/AdminScraper.jsx", "r") as f:
            src = f.read()
        assert "Tablo yapısı" in src, "frontend must render 'Tablo yapısı (debug)' section"
        assert "column_map" in src
        assert "sample_rows" in src
        assert "headers" in src

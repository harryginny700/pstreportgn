import os
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load frontend .env to get REACT_APP_BACKEND_URL
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def seeded(api_client):
    """Ensure database is freshly seeded before running tests."""
    r = api_client.post(f"{BASE_URL}/api/seed?force=true", timeout=30)
    assert r.status_code == 200, f"seed failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def cash_registers(api_client, seeded):
    r = api_client.get(f"{BASE_URL}/api/cash-registers", timeout=15)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="session")
def payment_methods(api_client, seeded):
    r = api_client.get(f"{BASE_URL}/api/payment-methods", timeout=15)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="session")
def debtors(api_client, seeded):
    r = api_client.get(f"{BASE_URL}/api/debtors", timeout=15)
    assert r.status_code == 200
    return r.json()


@pytest.fixture
def kasa_by_name(cash_registers):
    return {c["name"]: c for c in cash_registers}


@pytest.fixture
def pm_by_name(payment_methods):
    return {p["name"]: p for p in payment_methods}

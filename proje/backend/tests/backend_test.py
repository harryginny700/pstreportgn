"""Backend API tests for Sahne Finance (Turkish iGaming financial dashboard).

Covers:
- Seed data validity (cash registers, payment methods, debtors, commission rates)
- Transactions single + bulk with commission formula
- Credits, Expenses, Transfers updating balances
- Dashboard KPIs and shape
- Daily & Monthly reports
- CSV exports
- Payment method update
- Force reseed
"""
import os
import pytest
import requests
from datetime import date, timedelta

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


# ---------------- SEED / METADATA ----------------

class TestSeedData:
    def test_health(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_cash_registers_seeded(self, cash_registers):
        names = [c["name"] for c in cash_registers]
        expected = ["MAKSİ KASA", "PLUS KASA", "FTN KASA", "TONY KASA",
                    "TS KASA", "KARTAL KASA", "ALEX KASA", "KORAY KASA"]
        assert len(cash_registers) == 8, f"Expected 8 cash registers, got {len(cash_registers)}: {names}"
        for e in expected:
            assert e in names, f"Missing kasa: {e}"
        # Response must not include mongo _id
        for c in cash_registers:
            assert "_id" not in c
            assert "id" in c

    def test_payment_methods_seeded(self, payment_methods, pm_by_name):
        assert len(payment_methods) == 11, f"Expected 11 payment methods got {len(payment_methods)}"
        # commission rates per problem statement
        expected_rates = {
            "MAKSİ PAYFİX": (8, 1),
            "MAKSİ PAPARA": (8, 0),
            "MAKSİ HAVALE": (9, 1),
            "MAKSİ KRİPTO": (2, 3),
            "MAKSİ PEP": (7, 0),
            "MAKSİ PAYBOL&POPYPARA": (6, 0),
            "MAKSİ OZANPAY": (6, 1),
            "MAKSİ KREDİ KARTI": (10, 0),
            "PLUS HAVALE": (9, 0),
            "PLUS PAPARA": (8, 0),
            "FTN": (0, 0),
        }
        for name, (dep, wd) in expected_rates.items():
            assert name in pm_by_name, f"Missing payment method: {name}"
            pm = pm_by_name[name]
            assert pm["deposit_commission_pct"] == dep, f"{name} dep_pct mismatch"
            assert pm["withdrawal_commission_pct"] == wd, f"{name} wd_pct mismatch"

    def test_debtors_seeded(self, debtors):
        names = [d["name"] for d in debtors]
        assert len(debtors) == 4
        for e in ["OKİCEY", "MARDİNLİ47", "KEMALGEZER", "MUTOK35"]:
            assert e in names


# ---------------- TRANSACTIONS ----------------

class TestTransactions:
    def test_create_transaction_commission_and_net(self, api_client, pm_by_name):
        """deposit=10000, withdrawal=3000 on MAKSİ PAYFİX (8/1) => commission=830, net=6170."""
        pm = pm_by_name["MAKSİ PAYFİX"]
        payload = {
            "date": "2026-01-15",
            "payment_method_id": pm["id"],
            "deposit": 10000,
            "withdrawal": 3000,
            "note": "TEST_commission"
        }
        r = api_client.post(f"{BASE_URL}/api/transactions", json=payload)
        assert r.status_code == 200, r.text
        tx = r.json()
        assert tx["commission"] == 830.0, f"expected 830, got {tx['commission']}"
        assert tx["net"] == 6170.0, f"expected 6170, got {tx['net']}"
        assert tx["deposit"] == 10000
        assert tx["withdrawal"] == 3000
        # cleanup
        api_client.delete(f"{BASE_URL}/api/transactions/{tx['id']}")

    def test_bulk_transactions_overwrites_date(self, api_client, pm_by_name):
        pm = pm_by_name["MAKSİ PAPARA"]  # 8/0
        d = "2026-01-16"
        # Insert 2 initial rows
        p1 = {"date": d, "payment_method_id": pm["id"], "deposit": 1000, "withdrawal": 0}
        p2 = {"date": d, "payment_method_id": pm["id"], "deposit": 2000, "withdrawal": 0}
        api_client.post(f"{BASE_URL}/api/transactions", json=p1)
        api_client.post(f"{BASE_URL}/api/transactions", json=p2)
        r = api_client.get(f"{BASE_URL}/api/transactions", params={"date_from": d, "date_to": d})
        assert len(r.json()) >= 2

        # Bulk overwrite with a single entry
        bulk = {"date": d, "entries": [{"payment_method_id": pm["id"], "deposit": 5000, "withdrawal": 0}]}
        r = api_client.post(f"{BASE_URL}/api/transactions/bulk", json=bulk)
        assert r.status_code == 200, r.text
        assert r.json()["saved"] == 1

        r = api_client.get(f"{BASE_URL}/api/transactions", params={"date_from": d, "date_to": d})
        rows = r.json()
        assert len(rows) == 1, f"bulk should overwrite; got {len(rows)} rows"
        assert rows[0]["deposit"] == 5000
        # cleanup
        api_client.post(f"{BASE_URL}/api/transactions/bulk", json={"date": d, "entries": []})

    def test_bulk_zero_entries_skipped(self, api_client, pm_by_name):
        pm = pm_by_name["FTN"]
        d = "2026-01-17"
        bulk = {"date": d, "entries": [
            {"payment_method_id": pm["id"], "deposit": 0, "withdrawal": 0},
            {"payment_method_id": pm["id"], "deposit": 100, "withdrawal": 0},
        ]}
        r = api_client.post(f"{BASE_URL}/api/transactions/bulk", json=bulk)
        assert r.status_code == 200
        assert r.json()["saved"] == 1
        api_client.post(f"{BASE_URL}/api/transactions/bulk", json={"date": d, "entries": []})


# ---------------- BALANCES: EXPENSES / CREDITS / TRANSFERS ----------------

def _balance_for(balances, kid):
    for b in balances:
        if b["id"] == kid:
            return b["balance"]
    raise AssertionError(f"Kasa {kid} not in balances")


class TestBalanceFlows:
    def test_expense_reduces_balance(self, api_client, kasa_by_name):
        kasa = kasa_by_name["TONY KASA"]
        r = api_client.get(f"{BASE_URL}/api/dashboard")
        before = _balance_for(r.json()["balances"], kasa["id"])

        exp = {"date": "2026-01-18", "description": "TEST_expense",
               "amount": 500, "cash_register_id": kasa["id"]}
        r = api_client.post(f"{BASE_URL}/api/expenses", json=exp)
        assert r.status_code == 200
        eid = r.json()["id"]

        r = api_client.get(f"{BASE_URL}/api/dashboard")
        after = _balance_for(r.json()["balances"], kasa["id"])
        assert round(before - after, 2) == 500.0, f"expected -500, got {after - before}"

        # cleanup
        api_client.delete(f"{BASE_URL}/api/expenses/{eid}")

    def test_transfer_moves_funds(self, api_client, kasa_by_name):
        src = kasa_by_name["TS KASA"]
        dst = kasa_by_name["KARTAL KASA"]
        r = api_client.get(f"{BASE_URL}/api/dashboard")
        b = r.json()["balances"]
        src_before = _balance_for(b, src["id"])
        dst_before = _balance_for(b, dst["id"])

        tr = {"date": "2026-01-18", "from_cash_register_id": src["id"],
              "to_cash_register_id": dst["id"], "amount": 2500}
        r = api_client.post(f"{BASE_URL}/api/transfers", json=tr)
        assert r.status_code == 200
        tid = r.json()["id"]

        r = api_client.get(f"{BASE_URL}/api/dashboard")
        b = r.json()["balances"]
        assert round(_balance_for(b, src["id"]) - src_before, 2) == -2500.0
        assert round(_balance_for(b, dst["id"]) - dst_before, 2) == 2500.0

        api_client.delete(f"{BASE_URL}/api/transfers/{tid}")

    def test_credit_added_paid_updates_dashboard(self, api_client, debtors, kasa_by_name):
        debtor = debtors[0]
        kasa = kasa_by_name["ALEX KASA"]
        # Use explicit date range so KPIs pick up records regardless of server clock month.
        d = "2026-01-19"
        params = {"date_from": "2026-01-01", "date_to": "2026-01-31"}
        r = api_client.get(f"{BASE_URL}/api/dashboard", params=params)
        kpis_before = r.json()["kpis"]
        bal_before = _balance_for(r.json()["balances"], kasa["id"])

        c1 = {"date": d, "debtor_id": debtor["id"],
              "added": 1000, "paid": 0, "cash_register_id": kasa["id"]}
        c2 = {"date": d, "debtor_id": debtor["id"],
              "added": 0, "paid": 300, "cash_register_id": kasa["id"]}
        r1 = api_client.post(f"{BASE_URL}/api/credits", json=c1)
        r2 = api_client.post(f"{BASE_URL}/api/credits", json=c2)
        assert r1.status_code == 200 and r2.status_code == 200
        id1, id2 = r1.json()["id"], r2.json()["id"]

        r = api_client.get(f"{BASE_URL}/api/dashboard", params=params)
        kpis_after = r.json()["kpis"]
        bal_after = _balance_for(r.json()["balances"], kasa["id"])

        assert round(kpis_after["credits_added"] - kpis_before["credits_added"], 2) == 1000.0
        assert round(kpis_after["credits_paid"] - kpis_before["credits_paid"], 2) == 300.0
        # kasa balance: +1000 -300 = +700
        assert round(bal_after - bal_before, 2) == 700.0

        api_client.delete(f"{BASE_URL}/api/credits/{id1}")
        api_client.delete(f"{BASE_URL}/api/credits/{id2}")


# ---------------- DASHBOARD ----------------

class TestDashboard:
    def test_dashboard_shape(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/dashboard")
        assert r.status_code == 200
        d = r.json()
        for k in ["kpis", "balances", "daily_series", "payment_method_distribution", "range", "cash_registers"]:
            assert k in d, f"Missing key: {k}"
        for k in ["total_deposit", "total_withdrawal", "total_commission",
                  "net_transactions", "total_expense", "credits_added",
                  "credits_paid", "profit_loss", "total_cash"]:
            assert k in d["kpis"], f"Missing kpi: {k}"
        assert len(d["balances"]) == 8, "should have 8 kasa balances"


# ---------------- REPORTS ----------------

class TestReports:
    def test_monthly_report(self, api_client, pm_by_name):
        pm = pm_by_name["PLUS HAVALE"]  # 9/0
        d = "2026-01-20"
        # insert one transaction & one expense on this date
        tx = api_client.post(f"{BASE_URL}/api/transactions", json={
            "date": d, "payment_method_id": pm["id"],
            "deposit": 1000, "withdrawal": 0
        }).json()
        exp = api_client.post(f"{BASE_URL}/api/expenses", json={
            "date": d, "description": "TEST_monthly", "amount": 100,
            "cash_register_id": pm["cash_register_id"]
        }).json()

        r = api_client.get(f"{BASE_URL}/api/reports/monthly", params={"year": 2026, "month": 1})
        assert r.status_code == 200
        body = r.json()
        assert "summary" in body and "daily" in body
        for k in ["deposit", "withdrawal", "commission", "net", "expense", "profit_loss"]:
            assert k in body["summary"]
        day = next((x for x in body["daily"] if x["date"] == d), None)
        assert day is not None, f"day {d} missing in daily breakdown"
        assert "expense" in day and "profit_loss" in day
        # 1000 deposit, comm=90, net=910, expense=100, profit_loss=810
        assert day["net"] == 910.0
        assert day["expense"] == 100.0
        assert day["profit_loss"] == 810.0

        api_client.delete(f"{BASE_URL}/api/transactions/{tx['id']}")
        api_client.delete(f"{BASE_URL}/api/expenses/{exp['id']}")

    def test_daily_report(self, api_client, pm_by_name):
        pm = pm_by_name["MAKSİ PEP"]  # 7/0
        d = "2026-01-21"
        tx = api_client.post(f"{BASE_URL}/api/transactions", json={
            "date": d, "payment_method_id": pm["id"],
            "deposit": 500, "withdrawal": 100
        }).json()

        r = api_client.get(f"{BASE_URL}/api/reports/daily", params={"date": d})
        assert r.status_code == 200
        body = r.json()
        assert body["date"] == d
        assert "summary" in body
        assert len(body["transactions"]) >= 1
        # commission: 500*0.07 + 100*0 = 35; net = 500-100-35 = 365
        assert body["summary"]["commission"] == 35.0
        assert body["summary"]["net"] == 365.0

        api_client.delete(f"{BASE_URL}/api/transactions/{tx['id']}")


# ---------------- PAYMENT METHOD UPDATE ----------------

class TestPaymentMethodUpdate:
    def test_update_commission(self, api_client, pm_by_name):
        pm = pm_by_name["FTN"]
        payload = {
            "name": pm["name"],
            "cash_register_id": pm["cash_register_id"],
            "deposit_commission_pct": 5,
            "withdrawal_commission_pct": 2,
            "active": True,
        }
        r = api_client.put(f"{BASE_URL}/api/payment-methods/{pm['id']}", json=payload)
        assert r.status_code == 200
        assert r.json()["deposit_commission_pct"] == 5
        assert r.json()["withdrawal_commission_pct"] == 2

        # verify persisted
        r = api_client.get(f"{BASE_URL}/api/payment-methods")
        got = next(x for x in r.json() if x["id"] == pm["id"])
        assert got["deposit_commission_pct"] == 5
        assert got["withdrawal_commission_pct"] == 2

        # restore
        payload["deposit_commission_pct"] = 0
        payload["withdrawal_commission_pct"] = 0
        api_client.put(f"{BASE_URL}/api/payment-methods/{pm['id']}", json=payload)


# ---------------- EXPORTS ----------------

class TestExports:
    def test_export_transactions_csv(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/export/transactions",
                           params={"date_from": "2026-01-01", "date_to": "2026-01-31"})
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        # first line must have Turkish headers
        text = r.text
        assert "Tarih" in text and "Yatırım" in text and "Komisyon" in text

    def test_export_monthly_csv(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/export/monthly-report",
                           params={"year": 2026, "month": 1})
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        assert "Özet" in r.text or "2026-01" in r.text


# ---------------- FORCE RESEED ----------------

class TestReseed:
    def test_seed_force_wipes_and_reseeds(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/seed?force=true")
        assert r.status_code == 200
        body = r.json()
        assert body.get("seeded") is True
        assert body["kasalar"] == 8
        assert body["methods"] == 11
        assert body["debtors"] == 4

        # ensure lists match
        r = api_client.get(f"{BASE_URL}/api/cash-registers")
        assert len(r.json()) == 8
        r = api_client.get(f"{BASE_URL}/api/payment-methods")
        assert len(r.json()) == 11
        r = api_client.get(f"{BASE_URL}/api/debtors")
        assert len(r.json()) == 4

    def test_seed_without_force_returns_message(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/seed")
        assert r.status_code == 200
        assert r.json()["seeded"] is False

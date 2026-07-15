from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import io
import csv
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Literal
from datetime import datetime, date, timezone, timedelta
from calendar import monthrange


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Sahne Finance API")
api_router = APIRouter(prefix="/api")


# ============== MODELS ==============

def uid() -> str:
    return str(uuid.uuid4())


class CashRegister(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    name: str
    type: Literal["main", "finance"] = "main"  # main = ana kasa, finance = ödeme finans kasası
    parent_id: Optional[str] = None  # finance kasalar için ana kasa
    initial_balance: float = 0.0
    order: int = 0


class PaymentMethod(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    name: str
    cash_register_id: Optional[str] = None
    deposit_commission_pct: float = 0.0
    withdrawal_commission_pct: float = 0.0
    active: bool = True
    order: int = 0


class Debtor(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    name: str
    initial_balance: float = 0.0
    order: int = 0


class Transaction(BaseModel):
    """Günlük ödeme yöntemi bazında yatırım/çekim."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    date: str  # ISO date YYYY-MM-DD
    payment_method_id: str
    deposit: float = 0.0
    withdrawal: float = 0.0
    commission: float = 0.0
    net: float = 0.0
    note: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Credit(BaseModel):
    """Kredici hareketi."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    date: str
    debtor_id: str
    added: float = 0.0  # Eklenen (kredici bize verdi -> borç arttı)
    paid: float = 0.0   # Ödenen (biz krediciye ödedik -> borç azaldı)
    member_name: Optional[str] = None
    cash_register_id: Optional[str] = None
    note: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Expense(BaseModel):
    """Yapılan ödemeler / masraflar."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    date: str
    description: str  # ödeme yeri
    amount: float
    cash_register_id: str
    note: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Transfer(BaseModel):
    """Kasalar arası transfer."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    date: str
    from_cash_register_id: str
    to_cash_register_id: str
    amount: float
    note: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ============== INPUT SCHEMAS ==============

class TransactionInput(BaseModel):
    date: str
    payment_method_id: str
    deposit: float = 0.0
    withdrawal: float = 0.0
    note: Optional[str] = None


class CreditInput(BaseModel):
    date: str
    debtor_id: str
    added: float = 0.0
    paid: float = 0.0
    member_name: Optional[str] = None
    cash_register_id: Optional[str] = None
    note: Optional[str] = None


class ExpenseInput(BaseModel):
    date: str
    description: str
    amount: float
    cash_register_id: str
    note: Optional[str] = None


class TransferInput(BaseModel):
    date: str
    from_cash_register_id: str
    to_cash_register_id: str
    amount: float
    note: Optional[str] = None


class PaymentMethodInput(BaseModel):
    name: str
    cash_register_id: Optional[str] = None
    deposit_commission_pct: float = 0.0
    withdrawal_commission_pct: float = 0.0
    active: bool = True


class CashRegisterInput(BaseModel):
    name: str
    type: Literal["main", "finance"] = "main"
    parent_id: Optional[str] = None
    initial_balance: float = 0.0


class DebtorInput(BaseModel):
    name: str
    initial_balance: float = 0.0


# ============== HELPERS ==============

def strip_id(doc):
    if doc and "_id" in doc:
        doc.pop("_id", None)
    return doc


def compute_commission(deposit: float, withdrawal: float, dep_pct: float, wd_pct: float) -> float:
    return round((deposit * dep_pct / 100.0) + (withdrawal * wd_pct / 100.0), 2)


# ============== KASA / CASH REGISTER ==============

@api_router.get("/cash-registers")
async def list_cash_registers():
    docs = await db.cash_registers.find({}, {"_id": 0}).sort("order", 1).to_list(1000)
    return docs


@api_router.post("/cash-registers")
async def create_cash_register(inp: CashRegisterInput):
    obj = CashRegister(**inp.model_dump())
    await db.cash_registers.insert_one(obj.model_dump())
    return obj


@api_router.put("/cash-registers/{cid}")
async def update_cash_register(cid: str, inp: CashRegisterInput):
    result = await db.cash_registers.update_one({"id": cid}, {"$set": inp.model_dump()})
    if result.matched_count == 0:
        raise HTTPException(404, "Kasa bulunamadı")
    doc = await db.cash_registers.find_one({"id": cid}, {"_id": 0})
    return doc


@api_router.delete("/cash-registers/{cid}")
async def delete_cash_register(cid: str):
    await db.cash_registers.delete_one({"id": cid})
    return {"ok": True}


# ============== PAYMENT METHODS ==============

@api_router.get("/payment-methods")
async def list_payment_methods():
    docs = await db.payment_methods.find({}, {"_id": 0}).sort("order", 1).to_list(1000)
    return docs


@api_router.post("/payment-methods")
async def create_payment_method(inp: PaymentMethodInput):
    obj = PaymentMethod(**inp.model_dump())
    await db.payment_methods.insert_one(obj.model_dump())
    return obj


@api_router.put("/payment-methods/{pid}")
async def update_payment_method(pid: str, inp: PaymentMethodInput):
    result = await db.payment_methods.update_one({"id": pid}, {"$set": inp.model_dump()})
    if result.matched_count == 0:
        raise HTTPException(404, "Ödeme yöntemi bulunamadı")
    doc = await db.payment_methods.find_one({"id": pid}, {"_id": 0})
    return doc


@api_router.post("/payment-methods/reorder")
async def reorder_payment_methods(ids: List[str]):
    for i, pid in enumerate(ids):
        await db.payment_methods.update_one({"id": pid}, {"$set": {"order": i}})
    return {"ok": True, "count": len(ids)}


@api_router.delete("/payment-methods/{pid}")
async def delete_payment_method(pid: str):
    await db.payment_methods.delete_one({"id": pid})
    return {"ok": True}


# ============== DEBTORS ==============

@api_router.get("/debtors")
async def list_debtors():
    docs = await db.debtors.find({}, {"_id": 0}).sort("order", 1).to_list(1000)
    return docs


@api_router.post("/debtors")
async def create_debtor(inp: DebtorInput):
    obj = Debtor(**inp.model_dump())
    await db.debtors.insert_one(obj.model_dump())
    return obj


@api_router.put("/debtors/{did}")
async def update_debtor(did: str, inp: DebtorInput):
    await db.debtors.update_one({"id": did}, {"$set": inp.model_dump()})
    doc = await db.debtors.find_one({"id": did}, {"_id": 0})
    return doc


@api_router.delete("/debtors/{did}")
async def delete_debtor(did: str):
    await db.debtors.delete_one({"id": did})
    return {"ok": True}


# ============== TRANSACTIONS ==============

@api_router.get("/transactions")
async def list_transactions(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    payment_method_id: Optional[str] = None,
):
    q = {}
    if date_from and date_to:
        q["date"] = {"$gte": date_from, "$lte": date_to}
    elif date_from:
        q["date"] = {"$gte": date_from}
    elif date_to:
        q["date"] = {"$lte": date_to}
    if payment_method_id:
        q["payment_method_id"] = payment_method_id
    docs = await db.transactions.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    return docs


@api_router.post("/transactions")
async def create_transaction(inp: TransactionInput):
    pm = await db.payment_methods.find_one({"id": inp.payment_method_id}, {"_id": 0})
    if not pm:
        raise HTTPException(404, "Ödeme yöntemi bulunamadı")
    commission = compute_commission(inp.deposit, inp.withdrawal,
                                    pm["deposit_commission_pct"],
                                    pm["withdrawal_commission_pct"])
    net = round(inp.deposit - inp.withdrawal - commission, 2)
    obj = Transaction(
        date=inp.date,
        payment_method_id=inp.payment_method_id,
        deposit=inp.deposit,
        withdrawal=inp.withdrawal,
        commission=commission,
        net=net,
        note=inp.note,
    )
    await db.transactions.insert_one(obj.model_dump())
    return obj


@api_router.put("/transactions/{tid}")
async def update_transaction(tid: str, inp: TransactionInput):
    pm = await db.payment_methods.find_one({"id": inp.payment_method_id}, {"_id": 0})
    if not pm:
        raise HTTPException(404, "Ödeme yöntemi bulunamadı")
    commission = compute_commission(inp.deposit, inp.withdrawal,
                                    pm["deposit_commission_pct"],
                                    pm["withdrawal_commission_pct"])
    net = round(inp.deposit - inp.withdrawal - commission, 2)
    update = {
        "date": inp.date,
        "payment_method_id": inp.payment_method_id,
        "deposit": inp.deposit,
        "withdrawal": inp.withdrawal,
        "commission": commission,
        "net": net,
        "note": inp.note,
    }
    result = await db.transactions.update_one({"id": tid}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "İşlem bulunamadı")
    doc = await db.transactions.find_one({"id": tid}, {"_id": 0})
    return doc


@api_router.delete("/transactions/{tid}")
async def delete_transaction(tid: str):
    await db.transactions.delete_one({"id": tid})
    return {"ok": True}


# Bulk upsert for a specific date - overwrites all for that date
class BulkTransactionEntry(BaseModel):
    payment_method_id: str
    deposit: float = 0.0
    withdrawal: float = 0.0
    note: Optional[str] = None


class BulkTransactionInput(BaseModel):
    date: str
    entries: List[BulkTransactionEntry]


@api_router.post("/transactions/bulk")
async def bulk_save_transactions(inp: BulkTransactionInput):
    # Delete existing for this date, then insert new ones
    await db.transactions.delete_many({"date": inp.date})
    pms = await db.payment_methods.find({}, {"_id": 0}).to_list(1000)
    pm_map = {p["id"]: p for p in pms}
    saved = []
    for e in inp.entries:
        if e.deposit == 0 and e.withdrawal == 0:
            continue
        pm = pm_map.get(e.payment_method_id)
        if not pm:
            continue
        commission = compute_commission(e.deposit, e.withdrawal,
                                        pm["deposit_commission_pct"],
                                        pm["withdrawal_commission_pct"])
        net = round(e.deposit - e.withdrawal - commission, 2)
        obj = Transaction(
            date=inp.date,
            payment_method_id=e.payment_method_id,
            deposit=e.deposit,
            withdrawal=e.withdrawal,
            commission=commission,
            net=net,
            note=e.note,
        )
        await db.transactions.insert_one(obj.model_dump())
        saved.append(obj.model_dump())
    return {"saved": len(saved), "transactions": saved}


# ============== CREDITS ==============

@api_router.get("/credits")
async def list_credits(date_from: Optional[str] = None, date_to: Optional[str] = None):
    q = {}
    if date_from and date_to:
        q["date"] = {"$gte": date_from, "$lte": date_to}
    docs = await db.credits.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    return docs


@api_router.post("/credits")
async def create_credit(inp: CreditInput):
    obj = Credit(**inp.model_dump())
    await db.credits.insert_one(obj.model_dump())
    return obj


@api_router.put("/credits/{cid}")
async def update_credit(cid: str, inp: CreditInput):
    result = await db.credits.update_one({"id": cid}, {"$set": inp.model_dump()})
    if result.matched_count == 0:
        raise HTTPException(404, "Kredi kaydı bulunamadı")
    doc = await db.credits.find_one({"id": cid}, {"_id": 0})
    return doc


@api_router.delete("/credits/{cid}")
async def delete_credit(cid: str):
    await db.credits.delete_one({"id": cid})
    return {"ok": True}


# ============== EXPENSES ==============

@api_router.get("/expenses")
async def list_expenses(date_from: Optional[str] = None, date_to: Optional[str] = None):
    q = {}
    if date_from and date_to:
        q["date"] = {"$gte": date_from, "$lte": date_to}
    docs = await db.expenses.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    return docs


@api_router.post("/expenses")
async def create_expense(inp: ExpenseInput):
    obj = Expense(**inp.model_dump())
    await db.expenses.insert_one(obj.model_dump())
    return obj


@api_router.put("/expenses/{eid}")
async def update_expense(eid: str, inp: ExpenseInput):
    result = await db.expenses.update_one({"id": eid}, {"$set": inp.model_dump()})
    if result.matched_count == 0:
        raise HTTPException(404, "Gider bulunamadı")
    doc = await db.expenses.find_one({"id": eid}, {"_id": 0})
    return doc


@api_router.delete("/expenses/{eid}")
async def delete_expense(eid: str):
    await db.expenses.delete_one({"id": eid})
    return {"ok": True}


# ============== TRANSFERS ==============

@api_router.get("/transfers")
async def list_transfers(date_from: Optional[str] = None, date_to: Optional[str] = None):
    q = {}
    if date_from and date_to:
        q["date"] = {"$gte": date_from, "$lte": date_to}
    docs = await db.transfers.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    return docs


@api_router.post("/transfers")
async def create_transfer(inp: TransferInput):
    obj = Transfer(**inp.model_dump())
    await db.transfers.insert_one(obj.model_dump())
    return obj


@api_router.put("/transfers/{tid}")
async def update_transfer(tid: str, inp: TransferInput):
    result = await db.transfers.update_one({"id": tid}, {"$set": inp.model_dump()})
    if result.matched_count == 0:
        raise HTTPException(404, "Transfer bulunamadı")
    doc = await db.transfers.find_one({"id": tid}, {"_id": 0})
    return doc


@api_router.delete("/transfers/{tid}")
async def delete_transfer(tid: str):
    await db.transfers.delete_one({"id": tid})
    return {"ok": True}


# ============== REPORTS & DASHBOARD ==============

async def _sum_transactions(date_from: str, date_to: str):
    pipe = [
        {"$match": {"date": {"$gte": date_from, "$lte": date_to}}},
        {"$group": {
            "_id": None,
            "deposit": {"$sum": "$deposit"},
            "withdrawal": {"$sum": "$withdrawal"},
            "commission": {"$sum": "$commission"},
            "net": {"$sum": "$net"},
        }},
    ]
    async for row in db.transactions.aggregate(pipe):
        return {"deposit": row["deposit"], "withdrawal": row["withdrawal"],
                "commission": row["commission"], "net": row["net"]}
    return {"deposit": 0.0, "withdrawal": 0.0, "commission": 0.0, "net": 0.0}


async def _sum_expenses(date_from: str, date_to: str):
    pipe = [
        {"$match": {"date": {"$gte": date_from, "$lte": date_to}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ]
    async for row in db.expenses.aggregate(pipe):
        return row["total"]
    return 0.0


async def _sum_credits(date_from: str, date_to: str):
    pipe = [
        {"$match": {"date": {"$gte": date_from, "$lte": date_to}}},
        {"$group": {"_id": None, "added": {"$sum": "$added"}, "paid": {"$sum": "$paid"}}},
    ]
    async for row in db.credits.aggregate(pipe):
        return {"added": row["added"], "paid": row["paid"]}
    return {"added": 0.0, "paid": 0.0}


@api_router.get("/dashboard")
async def dashboard(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    today = date.today()
    if not date_from:
        date_from = today.replace(day=1).isoformat()
    if not date_to:
        _, last = monthrange(today.year, today.month)
        date_to = today.replace(day=last).isoformat()

    tx = await _sum_transactions(date_from, date_to)
    ex = await _sum_expenses(date_from, date_to)
    cr = await _sum_credits(date_from, date_to)

    # Kar/Zarar = Net(yatırım-çekim-komisyon) - Giderler
    profit = round(tx["net"] - ex, 2)

    # Kasa bakiyeleri
    cash_registers = await list_cash_registers()
    balances = await compute_all_balances()

    # Nakit akışı (günlük seriler)
    pipe = [
        {"$match": {"date": {"$gte": date_from, "$lte": date_to}}},
        {"$group": {
            "_id": "$date",
            "deposit": {"$sum": "$deposit"},
            "withdrawal": {"$sum": "$withdrawal"},
            "commission": {"$sum": "$commission"},
            "net": {"$sum": "$net"},
        }},
        {"$sort": {"_id": 1}},
    ]
    daily = []
    async for row in db.transactions.aggregate(pipe):
        daily.append({
            "date": row["_id"],
            "deposit": row["deposit"],
            "withdrawal": row["withdrawal"],
            "commission": row["commission"],
            "net": row["net"],
        })

    # Ödeme yöntemi dağılımı (yatırım bazlı)
    pipe2 = [
        {"$match": {"date": {"$gte": date_from, "$lte": date_to}}},
        {"$group": {
            "_id": "$payment_method_id",
            "deposit": {"$sum": "$deposit"},
            "withdrawal": {"$sum": "$withdrawal"},
            "commission": {"$sum": "$commission"},
        }},
    ]
    pms = await db.payment_methods.find({}, {"_id": 0}).to_list(1000)
    pm_names = {p["id"]: p["name"] for p in pms}
    pm_distribution = []
    async for row in db.transactions.aggregate(pipe2):
        pm_distribution.append({
            "payment_method_id": row["_id"],
            "name": pm_names.get(row["_id"], "?"),
            "deposit": row["deposit"],
            "withdrawal": row["withdrawal"],
            "commission": row["commission"],
        })

    return {
        "range": {"from": date_from, "to": date_to},
        "kpis": {
            "total_deposit": tx["deposit"],
            "total_withdrawal": tx["withdrawal"],
            "total_commission": tx["commission"],
            "net_transactions": tx["net"],
            "total_expense": ex,
            "credits_added": cr["added"],
            "credits_paid": cr["paid"],
            "profit_loss": profit,
            "total_cash": sum(b["balance"] for b in balances),
        },
        "cash_registers": cash_registers,
        "balances": balances,
        "daily_series": daily,
        "payment_method_distribution": pm_distribution,
    }


async def compute_all_balances():
    """Her kasanın anlık bakiyesi:
    balance = initial + (net transactions of assigned finance methods)
            + transferlerden gelen - transferlerden çıkan
            - giderler
            + krediler_eklenen - krediler_ödenen (kredi kasa hedefliyorsa)
    """
    cash_registers = await db.cash_registers.find({}, {"_id": 0}).to_list(1000)
    # payment method -> cash_register_id
    pms = await db.payment_methods.find({}, {"_id": 0}).to_list(1000)
    pm_to_kasa = {p["id"]: p.get("cash_register_id") for p in pms}

    # Aggregate net per cash register from transactions
    kasa_net = {c["id"]: 0.0 for c in cash_registers}
    async for tx in db.transactions.find({}, {"_id": 0}):
        kid = pm_to_kasa.get(tx["payment_method_id"])
        if kid and kid in kasa_net:
            kasa_net[kid] += tx.get("net", 0.0)

    # Transfers
    async for t in db.transfers.find({}, {"_id": 0}):
        if t["from_cash_register_id"] in kasa_net:
            kasa_net[t["from_cash_register_id"]] -= t["amount"]
        if t["to_cash_register_id"] in kasa_net:
            kasa_net[t["to_cash_register_id"]] += t["amount"]

    # Expenses
    async for e in db.expenses.find({}, {"_id": 0}):
        if e["cash_register_id"] in kasa_net:
            kasa_net[e["cash_register_id"]] -= e["amount"]

    # Credits (added = kasa'ya para geldi, paid = kasadan para çıktı)
    async for c in db.credits.find({}, {"_id": 0}):
        kid = c.get("cash_register_id")
        if kid and kid in kasa_net:
            kasa_net[kid] += c.get("added", 0.0)
            kasa_net[kid] -= c.get("paid", 0.0)

    result = []
    for c in cash_registers:
        result.append({
            "id": c["id"],
            "name": c["name"],
            "type": c.get("type", "main"),
            "parent_id": c.get("parent_id"),
            "initial_balance": c.get("initial_balance", 0.0),
            "balance": round(c.get("initial_balance", 0.0) + kasa_net[c["id"]], 2),
        })
    return result


@api_router.get("/reports/daily")
async def report_daily(date_str: str = Query(..., alias="date")):
    tx = await _sum_transactions(date_str, date_str)
    ex = await _sum_expenses(date_str, date_str)
    cr = await _sum_credits(date_str, date_str)

    # Detaylı satırlar
    txs = await db.transactions.find({"date": date_str}, {"_id": 0}).to_list(1000)
    exps = await db.expenses.find({"date": date_str}, {"_id": 0}).to_list(1000)
    creds = await db.credits.find({"date": date_str}, {"_id": 0}).to_list(1000)
    trs = await db.transfers.find({"date": date_str}, {"_id": 0}).to_list(1000)

    return {
        "date": date_str,
        "summary": {
            **tx,
            "expense": ex,
            "credit_added": cr["added"],
            "credit_paid": cr["paid"],
            "profit_loss": round(tx["net"] - ex, 2),
        },
        "transactions": txs,
        "expenses": exps,
        "credits": creds,
        "transfers": trs,
    }


@api_router.get("/reports/monthly")
async def report_monthly(year: int, month: int):
    _, last = monthrange(year, month)
    d_from = date(year, month, 1).isoformat()
    d_to = date(year, month, last).isoformat()

    tx = await _sum_transactions(d_from, d_to)
    ex = await _sum_expenses(d_from, d_to)
    cr = await _sum_credits(d_from, d_to)

    # daily breakdown
    pipe = [
        {"$match": {"date": {"$gte": d_from, "$lte": d_to}}},
        {"$group": {
            "_id": "$date",
            "deposit": {"$sum": "$deposit"},
            "withdrawal": {"$sum": "$withdrawal"},
            "commission": {"$sum": "$commission"},
            "net": {"$sum": "$net"},
        }},
        {"$sort": {"_id": 1}},
    ]
    daily = []
    async for row in db.transactions.aggregate(pipe):
        daily.append({"date": row["_id"], **{k: row[k] for k in ["deposit", "withdrawal", "commission", "net"]}})

    exp_pipe = [
        {"$match": {"date": {"$gte": d_from, "$lte": d_to}}},
        {"$group": {"_id": "$date", "total": {"$sum": "$amount"}}},
        {"$sort": {"_id": 1}},
    ]
    daily_exp = {}
    async for row in db.expenses.aggregate(exp_pipe):
        daily_exp[row["_id"]] = row["total"]

    for d in daily:
        d["expense"] = daily_exp.get(d["date"], 0.0)
        d["profit_loss"] = round(d["net"] - d["expense"], 2)

    return {
        "range": {"from": d_from, "to": d_to},
        "summary": {
            **tx,
            "expense": ex,
            "credit_added": cr["added"],
            "credit_paid": cr["paid"],
            "profit_loss": round(tx["net"] - ex, 2),
        },
        "daily": daily,
    }


# ============== EXPORT ==============

@api_router.get("/export/transactions")
async def export_transactions(date_from: str, date_to: str):
    txs = await db.transactions.find(
        {"date": {"$gte": date_from, "$lte": date_to}}, {"_id": 0}
    ).sort("date", 1).to_list(10000)
    pms = await db.payment_methods.find({}, {"_id": 0}).to_list(1000)
    pm_map = {p["id"]: p["name"] for p in pms}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Tarih", "Ödeme Yöntemi", "Yatırım", "Çekim", "Komisyon", "Net", "Not"])
    for t in txs:
        writer.writerow([
            t["date"],
            pm_map.get(t["payment_method_id"], "?"),
            t["deposit"],
            t["withdrawal"],
            t["commission"],
            t["net"],
            t.get("note", "") or "",
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="islemler_{date_from}_{date_to}.csv"'},
    )


@api_router.get("/export/monthly-report")
async def export_monthly_report(year: int, month: int):
    data = await report_monthly(year, month)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Ay", f"{year}-{month:02d}"])
    writer.writerow([])
    writer.writerow(["Özet"])
    for k, v in data["summary"].items():
        writer.writerow([k, v])
    writer.writerow([])
    writer.writerow(["Tarih", "Yatırım", "Çekim", "Komisyon", "Net", "Gider", "Kar/Zarar"])
    for d in data["daily"]:
        writer.writerow([d["date"], d["deposit"], d["withdrawal"], d["commission"], d["net"], d["expense"], d["profit_loss"]])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="rapor_{year}_{month:02d}.csv"'},
    )


# ============== SEED ==============

@api_router.post("/seed")
async def seed_data(force: bool = False):
    """Excel'deki varsayılan kasalar, ödeme yöntemleri ve krediciler."""
    if not force:
        existing = await db.cash_registers.count_documents({})
        if existing > 0:
            return {"seeded": False, "reason": "Veri zaten mevcut. force=true ile sıfırlayın."}

    # Sıfırla (force veya boş)
    await db.cash_registers.delete_many({})
    await db.payment_methods.delete_many({})
    await db.debtors.delete_many({})

    kasalar = [
        ("MAKSİ KASA", 1),
        ("PLUS KASA", 2),
        ("FTN KASA", 3),
        ("TONY KASA", 4),
        ("TS KASA", 5),
        ("KARTAL KASA", 6),
        ("ALEX KASA", 7),
        ("KORAY KASA", 8),
    ]
    kasa_ids = {}
    for name, order in kasalar:
        obj = CashRegister(name=name, type="main", order=order)
        await db.cash_registers.insert_one(obj.model_dump())
        kasa_ids[name] = obj.id

    # Ödeme yöntemleri (Excel'deki komisyon oranlarıyla)
    methods = [
        ("MAKSİ PAYFİX", "MAKSİ KASA", 8, 1),
        ("MAKSİ PAPARA", "MAKSİ KASA", 8, 0),
        ("MAKSİ HAVALE", "MAKSİ KASA", 9, 1),
        ("MAKSİ KRİPTO", "MAKSİ KASA", 2, 3),
        ("MAKSİ PEP", "MAKSİ KASA", 7, 0),
        ("MAKSİ PAYBOL&POPYPARA", "MAKSİ KASA", 6, 0),
        ("MAKSİ OZANPAY", "MAKSİ KASA", 6, 1),
        ("MAKSİ KREDİ KARTI", "MAKSİ KASA", 10, 0),
        ("PLUS HAVALE", "PLUS KASA", 9, 0),
        ("PLUS PAPARA", "PLUS KASA", 8, 0),
        ("FTN", "FTN KASA", 0, 0),
    ]
    for i, (name, kasa, dep, wd) in enumerate(methods):
        obj = PaymentMethod(
            name=name,
            cash_register_id=kasa_ids[kasa],
            deposit_commission_pct=dep,
            withdrawal_commission_pct=wd,
            order=i,
        )
        await db.payment_methods.insert_one(obj.model_dump())

    # Krediciler
    debtors = ["OKİCEY", "MARDİNLİ47", "KEMALGEZER", "MUTOK35"]
    for i, name in enumerate(debtors):
        obj = Debtor(name=name, order=i)
        await db.debtors.insert_one(obj.model_dump())

    return {"seeded": True, "kasalar": len(kasalar), "methods": len(methods), "debtors": len(debtors)}


# ============== ROOT ==============

@api_router.get("/")
async def root():
    return {"app": "Sahne Finance", "status": "ok"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def _startup():
    # Ensure indexes
    await db.transactions.create_index("date")
    await db.transactions.create_index("payment_method_id")
    await db.expenses.create_index("date")
    await db.credits.create_index("date")
    await db.transfers.create_index("date")
    # Auto-seed if empty
    count = await db.cash_registers.count_documents({})
    if count == 0:
        logger.info("İlk çalıştırma: Varsayılan veriler yükleniyor...")
        # Trigger seed by calling internally
        try:
            await seed_data(force=False)
        except Exception as e:
            logger.error(f"Seed hatası: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

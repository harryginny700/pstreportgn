from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Query, Depends, Request
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import io
import csv
import bcrypt
import jwt
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Literal
from datetime import datetime, date, timezone, timedelta
from calendar import monthrange


mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 12

app = FastAPI(title="Playspintech Finance API")
api_router = APIRouter(prefix="/api")


# ============== HELPERS ==============

def uid() -> str:
    return str(uuid.uuid4())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Yetkilendirme gerekli")
    token = auth[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Oturum süresi dolmuş")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Geçersiz token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "Kullanıcı bulunamadı")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("platform_role") != "admin":
        raise HTTPException(403, "Admin yetkisi gerekli")
    return user


def scope_filter(user: dict, site_id_override: Optional[str] = None) -> dict:
    """Return MongoDB filter enforcing site scope.
    - Admin without override: no site filter (sees all)
    - Admin with override: filter by that site
    - Site user: forced to their site
    """
    if user.get("platform_role") == "admin":
        if site_id_override:
            return {"site_id": site_id_override}
        return {}  # admin sees all
    # site user
    return {"site_id": user["site_id"]}


def resolve_site_id(user: dict, requested: Optional[str] = None) -> str:
    """Determine which site_id to use for a write operation."""
    if user.get("platform_role") == "admin":
        if not requested:
            raise HTTPException(400, "Admin için site_id gerekli")
        return requested
    return user["site_id"]


# ============== MODELS ==============

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    email: str
    name: Optional[str] = None
    password_hash: str
    platform_role: Optional[Literal["admin"]] = None  # global admin flag
    site_id: Optional[str] = None  # site user is scoped to this site
    site_role: Optional[Literal["owner", "operator"]] = None
    active: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Site(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    name: str
    slug: Optional[str] = None
    active: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CashRegister(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    site_id: str
    name: str
    type: Literal["main", "finance"] = "main"
    parent_id: Optional[str] = None
    initial_balance: float = 0.0
    order: int = 0


class PaymentMethod(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    site_id: str
    name: str
    cash_register_id: Optional[str] = None
    deposit_commission_pct: float = 0.0
    withdrawal_commission_pct: float = 0.0
    active: bool = True
    order: int = 0


class Debtor(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    site_id: str
    name: str
    initial_balance: float = 0.0
    order: int = 0


class Transaction(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    site_id: str
    date: str
    payment_method_id: str
    deposit: float = 0.0
    withdrawal: float = 0.0
    commission: float = 0.0
    net: float = 0.0
    note: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Credit(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    site_id: str
    date: str
    debtor_id: str
    added: float = 0.0
    paid: float = 0.0
    member_name: Optional[str] = None
    cash_register_id: Optional[str] = None
    note: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Expense(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    site_id: str
    date: str
    description: str
    amount: float
    cash_register_id: str
    note: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Transfer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    site_id: str
    date: str
    from_cash_register_id: str
    to_cash_register_id: str
    amount: float
    note: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ============== INPUT SCHEMAS ==============

class LoginInput(BaseModel):
    email: str
    password: str


class UserCreateInput(BaseModel):
    email: str
    password: str
    name: Optional[str] = None
    platform_role: Optional[Literal["admin"]] = None
    site_id: Optional[str] = None
    site_role: Optional[Literal["owner", "operator"]] = "operator"


class UserUpdateInput(BaseModel):
    name: Optional[str] = None
    password: Optional[str] = None
    active: Optional[bool] = None
    site_role: Optional[Literal["owner", "operator"]] = None


class SiteInput(BaseModel):
    name: str
    slug: Optional[str] = None
    active: bool = True


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


def compute_commission(deposit: float, withdrawal: float, dep_pct: float, wd_pct: float) -> float:
    return round((deposit * dep_pct / 100.0) + (withdrawal * wd_pct / 100.0), 2)


# ============== AUTH ==============

@api_router.post("/auth/login")
async def login(inp: LoginInput):
    email = inp.email.strip().lower()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("active", True):
        raise HTTPException(401, "E-posta veya şifre hatalı")
    if not verify_password(inp.password, user["password_hash"]):
        raise HTTPException(401, "E-posta veya şifre hatalı")
    token = create_token(user["id"])
    user.pop("_id", None)
    user.pop("password_hash", None)
    site = None
    if user.get("site_id"):
        site = await db.sites.find_one({"id": user["site_id"]}, {"_id": 0})
    return {"token": token, "user": user, "site": site}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    site = None
    if user.get("site_id"):
        site = await db.sites.find_one({"id": user["site_id"]}, {"_id": 0})
    return {"user": user, "site": site}


# ============== ADMIN: SITES ==============

@api_router.get("/admin/sites")
async def list_sites(user: dict = Depends(require_admin)):
    docs = await db.sites.find({}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    # attach stats
    for s in docs:
        s["user_count"] = await db.users.count_documents({"site_id": s["id"]})
    return docs


@api_router.post("/admin/sites")
async def create_site(inp: SiteInput, user: dict = Depends(require_admin)):
    obj = Site(**inp.model_dump())
    await db.sites.insert_one(obj.model_dump())
    return obj


@api_router.put("/admin/sites/{sid}")
async def update_site(sid: str, inp: SiteInput, user: dict = Depends(require_admin)):
    result = await db.sites.update_one({"id": sid}, {"$set": inp.model_dump()})
    if result.matched_count == 0:
        raise HTTPException(404, "Site bulunamadı")
    return await db.sites.find_one({"id": sid}, {"_id": 0})


@api_router.delete("/admin/sites/{sid}")
async def delete_site(sid: str, user: dict = Depends(require_admin)):
    # Cascade delete all site data
    for coll in ["cash_registers", "payment_methods", "debtors", "transactions", "credits", "expenses", "transfers"]:
        await db[coll].delete_many({"site_id": sid})
    await db.users.delete_many({"site_id": sid})
    await db.sites.delete_one({"id": sid})
    return {"ok": True}


# ============== ADMIN: USERS ==============

@api_router.get("/admin/users")
async def list_users(user: dict = Depends(require_admin)):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", 1).to_list(1000)
    return docs


@api_router.post("/admin/users")
async def create_user(inp: UserCreateInput, user: dict = Depends(require_admin)):
    email = inp.email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Bu e-posta zaten kayıtlı")
    # Validation: platform admin or site user, not both
    if inp.platform_role == "admin":
        obj = User(
            email=email,
            name=inp.name,
            password_hash=hash_password(inp.password),
            platform_role="admin",
        )
    else:
        if not inp.site_id:
            raise HTTPException(400, "Site kullanıcısı için site_id gerekli")
        site = await db.sites.find_one({"id": inp.site_id})
        if not site:
            raise HTTPException(404, "Site bulunamadı")
        obj = User(
            email=email,
            name=inp.name,
            password_hash=hash_password(inp.password),
            site_id=inp.site_id,
            site_role=inp.site_role or "operator",
        )
    d = obj.model_dump()
    await db.users.insert_one(d)
    d.pop("password_hash", None)
    d.pop("_id", None)
    return d


@api_router.put("/admin/users/{uid_}")
async def update_user(uid_: str, inp: UserUpdateInput, user: dict = Depends(require_admin)):
    update = {}
    if inp.name is not None:
        update["name"] = inp.name
    if inp.password:
        update["password_hash"] = hash_password(inp.password)
    if inp.active is not None:
        update["active"] = inp.active
    if inp.site_role is not None:
        update["site_role"] = inp.site_role
    if update:
        await db.users.update_one({"id": uid_}, {"$set": update})
    return await db.users.find_one({"id": uid_}, {"_id": 0, "password_hash": 0})


@api_router.delete("/admin/users/{uid_}")
async def delete_user(uid_: str, user: dict = Depends(require_admin)):
    if uid_ == user["id"]:
        raise HTTPException(400, "Kendinizi silemezsiniz")
    await db.users.delete_one({"id": uid_})
    return {"ok": True}


# ============== ADMIN: CROSS-SITE OVERVIEW ==============

@api_router.get("/admin/overview")
async def admin_overview(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user: dict = Depends(require_admin),
):
    today = date.today()
    if not date_from:
        date_from = today.replace(day=1).isoformat()
    if not date_to:
        _, last = monthrange(today.year, today.month)
        date_to = today.replace(day=last).isoformat()

    sites = await db.sites.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    per_site = []
    total_deposit = total_withdrawal = total_commission = total_expense = total_profit = 0.0
    for s in sites:
        pipe = [
            {"$match": {"site_id": s["id"], "date": {"$gte": date_from, "$lte": date_to}}},
            {"$group": {"_id": None,
                        "deposit": {"$sum": "$deposit"},
                        "withdrawal": {"$sum": "$withdrawal"},
                        "commission": {"$sum": "$commission"},
                        "net": {"$sum": "$net"}}},
        ]
        tx = {"deposit": 0.0, "withdrawal": 0.0, "commission": 0.0, "net": 0.0}
        async for row in db.transactions.aggregate(pipe):
            tx = row
        exp_pipe = [
            {"$match": {"site_id": s["id"], "date": {"$gte": date_from, "$lte": date_to}}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
        ]
        exp = 0.0
        async for row in db.expenses.aggregate(exp_pipe):
            exp = row["total"]
        pnl = round(tx["net"] - exp, 2)
        entry = {
            "site_id": s["id"], "site_name": s["name"],
            "deposit": tx["deposit"], "withdrawal": tx["withdrawal"],
            "commission": tx["commission"], "net": tx["net"],
            "expense": exp, "profit_loss": pnl,
        }
        per_site.append(entry)
        total_deposit += tx["deposit"]
        total_withdrawal += tx["withdrawal"]
        total_commission += tx["commission"]
        total_expense += exp
        total_profit += pnl

    return {
        "range": {"from": date_from, "to": date_to},
        "totals": {
            "deposit": total_deposit, "withdrawal": total_withdrawal,
            "commission": total_commission, "expense": total_expense,
            "profit_loss": total_profit, "site_count": len(sites),
        },
        "sites": per_site,
    }


# ============== SITE-SCOPED: CASH REGISTERS ==============

def _site_id_query_param(user: dict, requested: Optional[str]) -> Optional[str]:
    """For admin, allows ?site_id= override; for site users, ignores."""
    if user.get("platform_role") == "admin":
        return requested
    return None  # site user - already scoped via filter


@api_router.get("/cash-registers")
async def list_cash_registers(
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = scope_filter(user, _site_id_query_param(user, site_id))
    docs = await db.cash_registers.find(q, {"_id": 0}).sort("order", 1).to_list(1000)
    return docs


@api_router.post("/cash-registers")
async def create_cash_register(
    inp: CashRegisterInput,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    sid = resolve_site_id(user, site_id)
    obj = CashRegister(site_id=sid, **inp.model_dump())
    await db.cash_registers.insert_one(obj.model_dump())
    return obj


@api_router.put("/cash-registers/{cid}")
async def update_cash_register(cid: str, inp: CashRegisterInput, user: dict = Depends(get_current_user)):
    q = {"id": cid, **scope_filter(user)}
    result = await db.cash_registers.update_one(q, {"$set": inp.model_dump()})
    if result.matched_count == 0:
        raise HTTPException(404, "Kasa bulunamadı")
    return await db.cash_registers.find_one({"id": cid}, {"_id": 0})


@api_router.delete("/cash-registers/{cid}")
async def delete_cash_register(cid: str, user: dict = Depends(get_current_user)):
    q = {"id": cid, **scope_filter(user)}
    await db.cash_registers.delete_one(q)
    return {"ok": True}


# ============== SITE-SCOPED: PAYMENT METHODS ==============

@api_router.get("/payment-methods")
async def list_payment_methods(
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = scope_filter(user, _site_id_query_param(user, site_id))
    docs = await db.payment_methods.find(q, {"_id": 0}).sort("order", 1).to_list(1000)
    return docs


@api_router.post("/payment-methods")
async def create_payment_method(
    inp: PaymentMethodInput,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    sid = resolve_site_id(user, site_id)
    obj = PaymentMethod(site_id=sid, **inp.model_dump())
    await db.payment_methods.insert_one(obj.model_dump())
    return obj


@api_router.put("/payment-methods/{pid}")
async def update_payment_method(pid: str, inp: PaymentMethodInput, user: dict = Depends(get_current_user)):
    q = {"id": pid, **scope_filter(user)}
    result = await db.payment_methods.update_one(q, {"$set": inp.model_dump()})
    if result.matched_count == 0:
        raise HTTPException(404, "Yöntem bulunamadı")
    return await db.payment_methods.find_one({"id": pid}, {"_id": 0})


@api_router.post("/payment-methods/reorder")
async def reorder_payment_methods(ids: List[str], user: dict = Depends(get_current_user)):
    q_base = scope_filter(user)
    for i, pid in enumerate(ids):
        await db.payment_methods.update_one({"id": pid, **q_base}, {"$set": {"order": i}})
    return {"ok": True, "count": len(ids)}


@api_router.delete("/payment-methods/{pid}")
async def delete_payment_method(pid: str, user: dict = Depends(get_current_user)):
    q = {"id": pid, **scope_filter(user)}
    await db.payment_methods.delete_one(q)
    return {"ok": True}


# ============== SITE-SCOPED: DEBTORS ==============

@api_router.get("/debtors")
async def list_debtors(
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = scope_filter(user, _site_id_query_param(user, site_id))
    docs = await db.debtors.find(q, {"_id": 0}).sort("order", 1).to_list(1000)
    return docs


@api_router.post("/debtors")
async def create_debtor(
    inp: DebtorInput,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    sid = resolve_site_id(user, site_id)
    obj = Debtor(site_id=sid, **inp.model_dump())
    await db.debtors.insert_one(obj.model_dump())
    return obj


@api_router.put("/debtors/{did}")
async def update_debtor(did: str, inp: DebtorInput, user: dict = Depends(get_current_user)):
    q = {"id": did, **scope_filter(user)}
    await db.debtors.update_one(q, {"$set": inp.model_dump()})
    return await db.debtors.find_one({"id": did}, {"_id": 0})


@api_router.delete("/debtors/{did}")
async def delete_debtor(did: str, user: dict = Depends(get_current_user)):
    q = {"id": did, **scope_filter(user)}
    await db.debtors.delete_one(q)
    return {"ok": True}


# ============== SITE-SCOPED: TRANSACTIONS ==============

@api_router.get("/transactions")
async def list_transactions(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    payment_method_id: Optional[str] = None,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = scope_filter(user, _site_id_query_param(user, site_id))
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
async def create_transaction(
    inp: TransactionInput,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    sid = resolve_site_id(user, site_id)
    pm = await db.payment_methods.find_one({"id": inp.payment_method_id, "site_id": sid}, {"_id": 0})
    if not pm:
        raise HTTPException(404, "Ödeme yöntemi bulunamadı")
    commission = compute_commission(inp.deposit, inp.withdrawal, pm["deposit_commission_pct"], pm["withdrawal_commission_pct"])
    net = round(inp.deposit - inp.withdrawal - commission, 2)
    obj = Transaction(
        site_id=sid, date=inp.date, payment_method_id=inp.payment_method_id,
        deposit=inp.deposit, withdrawal=inp.withdrawal,
        commission=commission, net=net, note=inp.note,
    )
    await db.transactions.insert_one(obj.model_dump())
    return obj


@api_router.put("/transactions/{tid}")
async def update_transaction(tid: str, inp: TransactionInput, user: dict = Depends(get_current_user)):
    existing = await db.transactions.find_one({"id": tid, **scope_filter(user)}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "İşlem bulunamadı")
    pm = await db.payment_methods.find_one({"id": inp.payment_method_id, "site_id": existing["site_id"]}, {"_id": 0})
    if not pm:
        raise HTTPException(404, "Ödeme yöntemi bulunamadı")
    commission = compute_commission(inp.deposit, inp.withdrawal, pm["deposit_commission_pct"], pm["withdrawal_commission_pct"])
    net = round(inp.deposit - inp.withdrawal - commission, 2)
    update = {
        "date": inp.date, "payment_method_id": inp.payment_method_id,
        "deposit": inp.deposit, "withdrawal": inp.withdrawal,
        "commission": commission, "net": net, "note": inp.note,
    }
    await db.transactions.update_one({"id": tid}, {"$set": update})
    return await db.transactions.find_one({"id": tid}, {"_id": 0})


@api_router.delete("/transactions/{tid}")
async def delete_transaction(tid: str, user: dict = Depends(get_current_user)):
    await db.transactions.delete_one({"id": tid, **scope_filter(user)})
    return {"ok": True}


class BulkTransactionEntry(BaseModel):
    payment_method_id: str
    deposit: float = 0.0
    withdrawal: float = 0.0
    note: Optional[str] = None


class BulkTransactionInput(BaseModel):
    date: str
    entries: List[BulkTransactionEntry]


@api_router.post("/transactions/bulk")
async def bulk_save_transactions(
    inp: BulkTransactionInput,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    sid = resolve_site_id(user, site_id)
    await db.transactions.delete_many({"date": inp.date, "site_id": sid})
    pms = await db.payment_methods.find({"site_id": sid}, {"_id": 0}).to_list(1000)
    pm_map = {p["id"]: p for p in pms}
    saved = 0
    for e in inp.entries:
        if e.deposit == 0 and e.withdrawal == 0:
            continue
        pm = pm_map.get(e.payment_method_id)
        if not pm:
            continue
        commission = compute_commission(e.deposit, e.withdrawal, pm["deposit_commission_pct"], pm["withdrawal_commission_pct"])
        net = round(e.deposit - e.withdrawal - commission, 2)
        obj = Transaction(
            site_id=sid, date=inp.date, payment_method_id=e.payment_method_id,
            deposit=e.deposit, withdrawal=e.withdrawal,
            commission=commission, net=net, note=e.note,
        )
        await db.transactions.insert_one(obj.model_dump())
        saved += 1
    return {"saved": saved}


# ============== SITE-SCOPED: CREDITS ==============

@api_router.get("/credits")
async def list_credits(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = scope_filter(user, _site_id_query_param(user, site_id))
    if date_from and date_to:
        q["date"] = {"$gte": date_from, "$lte": date_to}
    docs = await db.credits.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    return docs


@api_router.post("/credits")
async def create_credit(
    inp: CreditInput,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    sid = resolve_site_id(user, site_id)
    obj = Credit(site_id=sid, **inp.model_dump())
    await db.credits.insert_one(obj.model_dump())
    return obj


@api_router.put("/credits/{cid}")
async def update_credit(cid: str, inp: CreditInput, user: dict = Depends(get_current_user)):
    result = await db.credits.update_one({"id": cid, **scope_filter(user)}, {"$set": inp.model_dump()})
    if result.matched_count == 0:
        raise HTTPException(404, "Kredi kaydı bulunamadı")
    return await db.credits.find_one({"id": cid}, {"_id": 0})


@api_router.delete("/credits/{cid}")
async def delete_credit(cid: str, user: dict = Depends(get_current_user)):
    await db.credits.delete_one({"id": cid, **scope_filter(user)})
    return {"ok": True}


# ============== SITE-SCOPED: EXPENSES ==============

@api_router.get("/expenses")
async def list_expenses(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = scope_filter(user, _site_id_query_param(user, site_id))
    if date_from and date_to:
        q["date"] = {"$gte": date_from, "$lte": date_to}
    docs = await db.expenses.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    return docs


@api_router.post("/expenses")
async def create_expense(
    inp: ExpenseInput,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    sid = resolve_site_id(user, site_id)
    obj = Expense(site_id=sid, **inp.model_dump())
    await db.expenses.insert_one(obj.model_dump())
    return obj


@api_router.put("/expenses/{eid}")
async def update_expense(eid: str, inp: ExpenseInput, user: dict = Depends(get_current_user)):
    result = await db.expenses.update_one({"id": eid, **scope_filter(user)}, {"$set": inp.model_dump()})
    if result.matched_count == 0:
        raise HTTPException(404, "Gider bulunamadı")
    return await db.expenses.find_one({"id": eid}, {"_id": 0})


@api_router.delete("/expenses/{eid}")
async def delete_expense(eid: str, user: dict = Depends(get_current_user)):
    await db.expenses.delete_one({"id": eid, **scope_filter(user)})
    return {"ok": True}


# ============== SITE-SCOPED: TRANSFERS ==============

@api_router.get("/transfers")
async def list_transfers(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = scope_filter(user, _site_id_query_param(user, site_id))
    if date_from and date_to:
        q["date"] = {"$gte": date_from, "$lte": date_to}
    docs = await db.transfers.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    return docs


@api_router.post("/transfers")
async def create_transfer(
    inp: TransferInput,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    sid = resolve_site_id(user, site_id)
    obj = Transfer(site_id=sid, **inp.model_dump())
    await db.transfers.insert_one(obj.model_dump())
    return obj


@api_router.put("/transfers/{tid}")
async def update_transfer(tid: str, inp: TransferInput, user: dict = Depends(get_current_user)):
    result = await db.transfers.update_one({"id": tid, **scope_filter(user)}, {"$set": inp.model_dump()})
    if result.matched_count == 0:
        raise HTTPException(404, "Transfer bulunamadı")
    return await db.transfers.find_one({"id": tid}, {"_id": 0})


@api_router.delete("/transfers/{tid}")
async def delete_transfer(tid: str, user: dict = Depends(get_current_user)):
    await db.transfers.delete_one({"id": tid, **scope_filter(user)})
    return {"ok": True}


# ============== REPORTS & DASHBOARD ==============

async def compute_balances_for_site(sid: str):
    cash_registers = await db.cash_registers.find({"site_id": sid}, {"_id": 0}).to_list(1000)
    pms = await db.payment_methods.find({"site_id": sid}, {"_id": 0}).to_list(1000)
    pm_to_kasa = {p["id"]: p.get("cash_register_id") for p in pms}
    kasa_net = {c["id"]: 0.0 for c in cash_registers}
    async for tx in db.transactions.find({"site_id": sid}, {"_id": 0}):
        kid = pm_to_kasa.get(tx["payment_method_id"])
        if kid and kid in kasa_net:
            kasa_net[kid] += tx.get("net", 0.0)
    async for t in db.transfers.find({"site_id": sid}, {"_id": 0}):
        if t["from_cash_register_id"] in kasa_net:
            kasa_net[t["from_cash_register_id"]] -= t["amount"]
        if t["to_cash_register_id"] in kasa_net:
            kasa_net[t["to_cash_register_id"]] += t["amount"]
    async for e in db.expenses.find({"site_id": sid}, {"_id": 0}):
        if e["cash_register_id"] in kasa_net:
            kasa_net[e["cash_register_id"]] -= e["amount"]
    async for c in db.credits.find({"site_id": sid}, {"_id": 0}):
        kid = c.get("cash_register_id")
        if kid and kid in kasa_net:
            kasa_net[kid] += c.get("added", 0.0)
            kasa_net[kid] -= c.get("paid", 0.0)
    result = []
    for c in cash_registers:
        result.append({
            "id": c["id"], "name": c["name"], "type": c.get("type", "main"),
            "parent_id": c.get("parent_id"),
            "initial_balance": c.get("initial_balance", 0.0),
            "balance": round(c.get("initial_balance", 0.0) + kasa_net[c["id"]], 2),
        })
    return result


@api_router.get("/dashboard")
async def dashboard(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    # Determine target site
    if user.get("platform_role") == "admin":
        target_site = site_id
        if not target_site:
            first = await db.sites.find_one({}, {"_id": 0}, sort=[("created_at", 1)])
            if not first:
                raise HTTPException(404, "Henüz bir site oluşturulmamış")
            target_site = first["id"]
    else:
        target_site = user["site_id"]

    today = date.today()
    if not date_from:
        date_from = today.replace(day=1).isoformat()
    if not date_to:
        _, last = monthrange(today.year, today.month)
        date_to = today.replace(day=last).isoformat()

    q = {"site_id": target_site, "date": {"$gte": date_from, "$lte": date_to}}

    pipe = [{"$match": q}, {"$group": {"_id": None,
                                       "deposit": {"$sum": "$deposit"}, "withdrawal": {"$sum": "$withdrawal"},
                                       "commission": {"$sum": "$commission"}, "net": {"$sum": "$net"}}}]
    tx = {"deposit": 0.0, "withdrawal": 0.0, "commission": 0.0, "net": 0.0}
    async for row in db.transactions.aggregate(pipe):
        tx = row

    ex = 0.0
    async for row in db.expenses.aggregate([{"$match": q}, {"$group": {"_id": None, "total": {"$sum": "$amount"}}}]):
        ex = row["total"]

    cr = {"added": 0.0, "paid": 0.0}
    async for row in db.credits.aggregate([{"$match": q}, {"$group": {"_id": None, "added": {"$sum": "$added"}, "paid": {"$sum": "$paid"}}}]):
        cr = row

    profit = round(tx["net"] - ex, 2)
    balances = await compute_balances_for_site(target_site)

    daily = []
    async for row in db.transactions.aggregate([
        {"$match": q},
        {"$group": {"_id": "$date", "deposit": {"$sum": "$deposit"}, "withdrawal": {"$sum": "$withdrawal"},
                    "commission": {"$sum": "$commission"}, "net": {"$sum": "$net"}}},
        {"$sort": {"_id": 1}},
    ]):
        daily.append({"date": row["_id"], "deposit": row["deposit"], "withdrawal": row["withdrawal"],
                     "commission": row["commission"], "net": row["net"]})

    pms = await db.payment_methods.find({"site_id": target_site}, {"_id": 0}).to_list(1000)
    pm_names = {p["id"]: p["name"] for p in pms}
    pm_distribution = []
    async for row in db.transactions.aggregate([
        {"$match": q},
        {"$group": {"_id": "$payment_method_id", "deposit": {"$sum": "$deposit"},
                    "withdrawal": {"$sum": "$withdrawal"}, "commission": {"$sum": "$commission"}}},
    ]):
        pm_distribution.append({"payment_method_id": row["_id"], "name": pm_names.get(row["_id"], "?"),
                                "deposit": row["deposit"], "withdrawal": row["withdrawal"], "commission": row["commission"]})

    site = await db.sites.find_one({"id": target_site}, {"_id": 0})

    return {
        "site": site,
        "range": {"from": date_from, "to": date_to},
        "kpis": {
            "total_deposit": tx["deposit"], "total_withdrawal": tx["withdrawal"],
            "total_commission": tx["commission"], "net_transactions": tx["net"],
            "total_expense": ex, "credits_added": cr["added"], "credits_paid": cr["paid"],
            "profit_loss": profit, "total_cash": sum(b["balance"] for b in balances),
        },
        "balances": balances,
        "daily_series": daily,
        "payment_method_distribution": pm_distribution,
    }


@api_router.get("/reports/daily")
async def report_daily(
    date_str: str = Query(..., alias="date"),
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = scope_filter(user, _site_id_query_param(user, site_id))
    if user.get("platform_role") == "admin" and not site_id:
        first = await db.sites.find_one({}, {"_id": 0}, sort=[("created_at", 1)])
        if first:
            q["site_id"] = first["id"]
    q["date"] = date_str

    tx_agg = {"deposit": 0.0, "withdrawal": 0.0, "commission": 0.0, "net": 0.0}
    async for row in db.transactions.aggregate([{"$match": q}, {"$group": {"_id": None,
                                                                             "deposit": {"$sum": "$deposit"}, "withdrawal": {"$sum": "$withdrawal"},
                                                                             "commission": {"$sum": "$commission"}, "net": {"$sum": "$net"}}}]):
        tx_agg = row
    ex = 0.0
    async for row in db.expenses.aggregate([{"$match": q}, {"$group": {"_id": None, "total": {"$sum": "$amount"}}}]):
        ex = row["total"]
    cr = {"added": 0.0, "paid": 0.0}
    async for row in db.credits.aggregate([{"$match": q}, {"$group": {"_id": None, "added": {"$sum": "$added"}, "paid": {"$sum": "$paid"}}}]):
        cr = row

    txs = await db.transactions.find(q, {"_id": 0}).to_list(1000)
    exps = await db.expenses.find(q, {"_id": 0}).to_list(1000)
    creds = await db.credits.find(q, {"_id": 0}).to_list(1000)
    trs = await db.transfers.find(q, {"_id": 0}).to_list(1000)

    return {
        "date": date_str,
        "summary": {**tx_agg, "expense": ex, "credit_added": cr["added"], "credit_paid": cr["paid"], "profit_loss": round(tx_agg["net"] - ex, 2)},
        "transactions": txs, "expenses": exps, "credits": creds, "transfers": trs,
    }


@api_router.get("/reports/monthly")
async def report_monthly(
    year: int,
    month: int,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    _, last = monthrange(year, month)
    d_from = date(year, month, 1).isoformat()
    d_to = date(year, month, last).isoformat()

    q = scope_filter(user, _site_id_query_param(user, site_id))
    if user.get("platform_role") == "admin" and not site_id:
        first = await db.sites.find_one({}, {"_id": 0}, sort=[("created_at", 1)])
        if first:
            q["site_id"] = first["id"]
    q["date"] = {"$gte": d_from, "$lte": d_to}

    tx_agg = {"deposit": 0.0, "withdrawal": 0.0, "commission": 0.0, "net": 0.0}
    async for row in db.transactions.aggregate([{"$match": q}, {"$group": {"_id": None,
                                                                             "deposit": {"$sum": "$deposit"}, "withdrawal": {"$sum": "$withdrawal"},
                                                                             "commission": {"$sum": "$commission"}, "net": {"$sum": "$net"}}}]):
        tx_agg = row
    ex = 0.0
    async for row in db.expenses.aggregate([{"$match": q}, {"$group": {"_id": None, "total": {"$sum": "$amount"}}}]):
        ex = row["total"]
    cr = {"added": 0.0, "paid": 0.0}
    async for row in db.credits.aggregate([{"$match": q}, {"$group": {"_id": None, "added": {"$sum": "$added"}, "paid": {"$sum": "$paid"}}}]):
        cr = row

    daily = []
    async for row in db.transactions.aggregate([{"$match": q},
                                                {"$group": {"_id": "$date", "deposit": {"$sum": "$deposit"},
                                                            "withdrawal": {"$sum": "$withdrawal"}, "commission": {"$sum": "$commission"}, "net": {"$sum": "$net"}}},
                                                {"$sort": {"_id": 1}}]):
        daily.append({"date": row["_id"], "deposit": row["deposit"], "withdrawal": row["withdrawal"], "commission": row["commission"], "net": row["net"]})

    daily_exp = {}
    async for row in db.expenses.aggregate([{"$match": q},
                                             {"$group": {"_id": "$date", "total": {"$sum": "$amount"}}},
                                             {"$sort": {"_id": 1}}]):
        daily_exp[row["_id"]] = row["total"]
    for d in daily:
        d["expense"] = daily_exp.get(d["date"], 0.0)
        d["profit_loss"] = round(d["net"] - d["expense"], 2)

    return {
        "range": {"from": d_from, "to": d_to},
        "summary": {**tx_agg, "expense": ex, "credit_added": cr["added"], "credit_paid": cr["paid"], "profit_loss": round(tx_agg["net"] - ex, 2)},
        "daily": daily,
    }


# ============== EXPORT ==============

@api_router.get("/export/transactions")
async def export_transactions(
    date_from: str,
    date_to: str,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = scope_filter(user, _site_id_query_param(user, site_id))
    if user.get("platform_role") == "admin" and not site_id:
        first = await db.sites.find_one({}, {"_id": 0}, sort=[("created_at", 1)])
        if first:
            q["site_id"] = first["id"]
    q["date"] = {"$gte": date_from, "$lte": date_to}
    txs = await db.transactions.find(q, {"_id": 0}).sort("date", 1).to_list(10000)
    pms = await db.payment_methods.find({}, {"_id": 0}).to_list(1000)
    pm_map = {p["id"]: p["name"] for p in pms}
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Tarih", "Ödeme Yöntemi", "Yatırım", "Çekim", "Komisyon", "Net", "Not"])
    for t in txs:
        writer.writerow([t["date"], pm_map.get(t["payment_method_id"], "?"), t["deposit"], t["withdrawal"], t["commission"], t["net"], t.get("note", "") or ""])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="islemler_{date_from}_{date_to}.csv"'})


@api_router.get("/export/monthly-report")
async def export_monthly_report(
    year: int,
    month: int,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    data = await report_monthly(year, month, site_id, user)
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
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="rapor_{year}_{month:02d}.csv"'})


# ============== ROOT ==============

@api_router.get("/")
async def root():
    return {"app": "Playspintech Finance", "status": "ok"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============== SEED / MIGRATION ==============

async def seed_admin_and_migrate():
    admin_email = os.environ["ADMIN_EMAIL"].strip().lower()
    admin_password = os.environ["ADMIN_PASSWORD"]

    # Ensure admin exists
    existing_admin = await db.users.find_one({"email": admin_email})
    if not existing_admin:
        admin = User(
            email=admin_email,
            name="Playspintech Admin",
            password_hash=hash_password(admin_password),
            platform_role="admin",
        )
        await db.users.insert_one(admin.model_dump())
        logger.info(f"Admin seeded: {admin_email}")
    else:
        # Update password if env changed
        if not verify_password(admin_password, existing_admin["password_hash"]):
            await db.users.update_one({"email": admin_email},
                                      {"$set": {"password_hash": hash_password(admin_password)}})
            logger.info(f"Admin password updated: {admin_email}")

    # Migrate existing data: if there is any data without site_id, create "Etobahis" site and assign
    sites_count = await db.sites.count_documents({})
    if sites_count == 0:
        # Create default Etobahis site
        etobahis = Site(name="Etobahis", slug="etobahis")
        await db.sites.insert_one(etobahis.model_dump())
        logger.info(f"Default site 'Etobahis' created: {etobahis.id}")

        # Backfill site_id for all existing docs
        for coll in ["cash_registers", "payment_methods", "debtors",
                     "transactions", "credits", "expenses", "transfers"]:
            r = await db[coll].update_many({"site_id": {"$exists": False}}, {"$set": {"site_id": etobahis.id}})
            if r.modified_count > 0:
                logger.info(f"  {coll}: {r.modified_count} docs backfilled")

        # If NO cash_registers exist for this site (fresh install), seed defaults
        cr_count = await db.cash_registers.count_documents({"site_id": etobahis.id})
        if cr_count == 0:
            await _seed_default_site_data(etobahis.id)


async def _seed_default_site_data(site_id: str):
    kasalar = [
        ("MAKSİ KASA", 1), ("PLUS KASA", 2), ("FTN KASA", 3),
        ("TONY KASA", 4), ("TS KASA", 5), ("KARTAL KASA", 6),
        ("ALEX KASA", 7), ("KORAY KASA", 8),
    ]
    kasa_ids = {}
    for name, order in kasalar:
        obj = CashRegister(site_id=site_id, name=name, type="main", order=order)
        await db.cash_registers.insert_one(obj.model_dump())
        kasa_ids[name] = obj.id

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
        obj = PaymentMethod(site_id=site_id, name=name,
                            cash_register_id=kasa_ids[kasa],
                            deposit_commission_pct=dep,
                            withdrawal_commission_pct=wd, order=i)
        await db.payment_methods.insert_one(obj.model_dump())

    for i, name in enumerate(["OKİCEY", "MARDİNLİ47", "KEMALGEZER", "MUTOK35"]):
        obj = Debtor(site_id=site_id, name=name, order=i)
        await db.debtors.insert_one(obj.model_dump())


# Admin can also seed default data into a newly created site
@api_router.post("/admin/sites/{sid}/seed-defaults")
async def seed_defaults(sid: str, user: dict = Depends(require_admin)):
    site = await db.sites.find_one({"id": sid})
    if not site:
        raise HTTPException(404, "Site bulunamadı")
    existing = await db.cash_registers.count_documents({"site_id": sid})
    if existing > 0:
        raise HTTPException(400, "Bu sitede zaten veri var")
    await _seed_default_site_data(sid)
    return {"ok": True}


@app.on_event("startup")
async def _startup():
    await db.transactions.create_index([("site_id", 1), ("date", 1)])
    await db.transactions.create_index("payment_method_id")
    await db.expenses.create_index([("site_id", 1), ("date", 1)])
    await db.credits.create_index([("site_id", 1), ("date", 1)])
    await db.transfers.create_index([("site_id", 1), ("date", 1)])
    await db.cash_registers.create_index("site_id")
    await db.payment_methods.create_index("site_id")
    await db.debtors.create_index("site_id")
    await db.users.create_index("email", unique=True)
    await db.sites.create_index("name")
    try:
        await seed_admin_and_migrate()
    except Exception as e:
        logger.error(f"Seed/migrate hatası: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

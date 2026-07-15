from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Query, Depends, Request
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import asyncio
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

# Brute-force protection: track failed login attempts per email (in-memory)
LOGIN_ATTEMPTS: dict = {}  # {email: {"count": int, "locked_until": datetime}}
MAX_ATTEMPTS = 5
LOCKOUT_MINUTES = 15
MIN_PASSWORD_LENGTH = 6

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
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0, "totp_secret": 0})
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
    totp_secret: Optional[str] = None
    totp_enabled: bool = False
    totp_enabled_at: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Site(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    name: str
    slug: Optional[str] = None
    active: bool = True
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
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


class SiteCredit(BaseModel):
    """Admin-only: Playspintech'in bir site'a verdiği kredi ve karşılık borç kaydı."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    site_id: str
    amount: float  # verilen kredi miktarı (TL)
    commission_pct: float  # yüzde (örn. 5.0 = %5)
    debt: float  # hesaplanmış borç = amount * commission_pct / 100
    paid_amount: float = 0.0  # kümülatif ödenen miktar
    payments: List[dict] = Field(default_factory=list)  # [{amount, date, paid_at, paid_by_email, note?}]
    note: Optional[str] = None
    status: str = "unpaid"  # "unpaid" | "partial" | "paid"
    archived: bool = False
    date: str = Field(default_factory=lambda: datetime.now(timezone.utc).date().isoformat())
    paid_at: Optional[str] = None  # borç tamamen ödendiği zaman
    paid_by_email: Optional[str] = None
    archived_at: Optional[str] = None
    archived_by_email: Optional[str] = None
    created_by_email: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class MonthlyRollover(BaseModel):
    """Aylık devir arşivi. Verileri silmez, sadece o ayın snapshot'ını saklar."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    site_id: str
    year: int
    month: int  # 1-12
    closed_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    closed_by_user_id: str
    closed_by_email: str
    summary: dict  # deposit, withdrawal, commission, net, expense, credit_added, credit_paid, profit_loss
    kasa_snapshots: List[dict]  # [{id, name, opening_balance, closing_balance, delta}]
    debtor_snapshots: List[dict]  # [{id, name, balance}]
    total_cash_at_close: float
    note: Optional[str] = None


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
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None


class TelegramConfigInput(BaseModel):
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None


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


class SiteCreditInput(BaseModel):
    site_id: str
    amount: float
    commission_pct: float
    note: Optional[str] = None
    date: Optional[str] = None


class SiteCreditPaymentInput(BaseModel):
    amount: float
    date: Optional[str] = None
    note: Optional[str] = None


class DebtorInput(BaseModel):
    name: str
    initial_balance: float = 0.0


def compute_commission(deposit: float, withdrawal: float, dep_pct: float, wd_pct: float) -> float:
    return round((deposit * dep_pct / 100.0) + (withdrawal * wd_pct / 100.0), 2)


# ============== AUTH ==============

@api_router.post("/auth/login")
async def login(inp: LoginInput):
    email = inp.email.strip().lower()

    # Brute-force check
    entry = LOGIN_ATTEMPTS.get(email)
    now = datetime.now(timezone.utc)
    if entry and entry.get("locked_until") and now < entry["locked_until"]:
        remaining = int((entry["locked_until"] - now).total_seconds() / 60) + 1
        raise HTTPException(429, f"Çok fazla başarısız deneme. {remaining} dakika sonra tekrar deneyin.")

    user = await db.users.find_one({"email": email})
    invalid = (not user) or (not user.get("active", True)) or (not verify_password(inp.password, user["password_hash"]))

    if invalid:
        # Increment attempts
        e = LOGIN_ATTEMPTS.get(email, {"count": 0})
        e["count"] = e.get("count", 0) + 1
        if e["count"] >= MAX_ATTEMPTS:
            e["locked_until"] = now + timedelta(minutes=LOCKOUT_MINUTES)
            e["count"] = 0
            LOGIN_ATTEMPTS[email] = e
            raise HTTPException(429, f"Çok fazla başarısız deneme. {LOCKOUT_MINUTES} dakika sonra tekrar deneyin.")
        LOGIN_ATTEMPTS[email] = e
        raise HTTPException(401, "E-posta veya şifre hatalı")

    # Success: clear attempts
    LOGIN_ATTEMPTS.pop(email, None)

    # 2FA challenge (if enabled)
    if user.get("totp_enabled"):
        challenge = jwt.encode({
            "sub": user["id"],
            "type": "2fa_challenge",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        }, JWT_SECRET, algorithm=JWT_ALGORITHM)
        return {"requires_2fa": True, "challenge_token": challenge, "email": user["email"]}

    token = create_token(user["id"])
    user.pop("_id", None)
    user.pop("password_hash", None)
    user.pop("totp_secret", None)
    site = None
    if user.get("site_id"):
        site = await db.sites.find_one({"id": user["site_id"]}, {"_id": 0})
    await log_audit(user, "auth.login", "user", user["id"], target_name=user["email"], site_id=user.get("site_id"))
    return {"token": token, "user": user, "site": site}


class TOTPVerifyInput(BaseModel):
    challenge_token: str
    code: str


@api_router.post("/auth/login/2fa")
async def verify_login_2fa(inp: TOTPVerifyInput):
    """Second step of 2FA login: verify TOTP code against challenge token → issue JWT."""
    try:
        payload = jwt.decode(inp.challenge_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "2fa_challenge":
            raise HTTPException(401, "Geçersiz doğrulama token'ı")
        user_id = payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Doğrulama süresi doldu, tekrar giriş yapın")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Geçersiz doğrulama token'ı")

    user = await db.users.find_one({"id": user_id})
    if not user or not user.get("totp_enabled") or not user.get("totp_secret"):
        raise HTTPException(401, "2FA yapılandırılmamış")

    import pyotp
    totp = pyotp.TOTP(user["totp_secret"])
    code = (inp.code or "").strip().replace(" ", "")
    if not totp.verify(code, valid_window=1):
        raise HTTPException(401, "Kod hatalı veya süresi dolmuş")

    token = create_token(user["id"])
    user.pop("_id", None)
    user.pop("password_hash", None)
    user.pop("totp_secret", None)
    site = None
    if user.get("site_id"):
        site = await db.sites.find_one({"id": user["site_id"]}, {"_id": 0})
    await log_audit(user, "auth.login_2fa", "user", user["id"], target_name=user["email"], site_id=user.get("site_id"))
    return {"token": token, "user": user, "site": site}


class TOTPSetupVerifyInput(BaseModel):
    code: str


@api_router.post("/auth/2fa/setup")
async def totp_setup(user: dict = Depends(get_current_user)):
    """Start 2FA setup: generate new secret, provisioning URI + QR (as data URL). Does NOT enable until verified."""
    import pyotp, qrcode, io, base64
    secret = pyotp.random_base32()
    # Store the pending secret; will only mark enabled after verify-setup succeeds.
    await db.users.update_one({"id": user["id"]}, {"$set": {"totp_secret": secret, "totp_enabled": False}})
    issuer = "Playspintech"
    label = user["email"]
    uri = pyotp.TOTP(secret).provisioning_uri(name=label, issuer_name=issuer)
    # Generate QR PNG data URL
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()
    return {"secret": secret, "provisioning_uri": uri, "qr_data_url": f"data:image/png;base64,{qr_b64}"}


@api_router.post("/auth/2fa/verify-setup")
async def totp_verify_setup(inp: TOTPSetupVerifyInput, user: dict = Depends(get_current_user)):
    """Verify the code produced by the pending secret; if valid, mark 2FA as enabled."""
    fresh = await db.users.find_one({"id": user["id"]})
    if not fresh or not fresh.get("totp_secret"):
        raise HTTPException(400, "Önce 2FA kurulumunu başlatın")
    import pyotp
    totp = pyotp.TOTP(fresh["totp_secret"])
    code = (inp.code or "").strip().replace(" ", "")
    if not totp.verify(code, valid_window=1):
        raise HTTPException(400, "Kod hatalı — QR'ı doğru taradığınızdan emin olun")
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"id": user["id"]}, {"$set": {"totp_enabled": True, "totp_enabled_at": now}})
    await log_audit(user, "auth.2fa_enable", "user", user["id"], target_name=user["email"], site_id=user.get("site_id"))
    return {"ok": True}


class TOTPDisableInput(BaseModel):
    current_password: str


@api_router.post("/auth/2fa/disable")
async def totp_disable(inp: TOTPDisableInput, user: dict = Depends(get_current_user)):
    """Disable 2FA for the current user. Admins with mandatory 2FA cannot self-disable."""
    fresh = await db.users.find_one({"id": user["id"]})
    if not fresh or not fresh.get("totp_enabled"):
        raise HTTPException(400, "2FA zaten kapalı")
    if not verify_password(inp.current_password, fresh["password_hash"]):
        raise HTTPException(401, "Mevcut şifre hatalı")
    if user.get("platform_role") == "admin":
        raise HTTPException(403, "Admin hesaplarında 2FA zorunludur. Devre dışı bırakmak için başka bir adminden sıfırlamasını isteyin.")
    await db.users.update_one({"id": user["id"]}, {"$set": {"totp_enabled": False, "totp_secret": None, "totp_enabled_at": None}})
    await log_audit(user, "auth.2fa_disable", "user", user["id"], target_name=user["email"], site_id=user.get("site_id"))
    return {"ok": True}


@api_router.post("/admin/users/{uid_}/2fa-reset")
async def admin_reset_2fa(uid_: str, user: dict = Depends(require_admin)):
    """Admin-only: clear another user's TOTP config, forcing them to re-set up (or removing it for non-admins)."""
    target = await db.users.find_one({"id": uid_})
    if not target:
        raise HTTPException(404, "Kullanıcı bulunamadı")
    if target["id"] == user["id"]:
        raise HTTPException(400, "Kendi 2FA'nızı sıfırlamak için başka bir admin gerekli")
    await db.users.update_one({"id": uid_}, {"$set": {"totp_enabled": False, "totp_secret": None, "totp_enabled_at": None}})
    await log_audit(user, "auth.2fa_reset", "user", uid_, target_name=target["email"], site_id=target.get("site_id"))
    return {"ok": True}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    site = None
    if user.get("site_id"):
        site = await db.sites.find_one({"id": user["site_id"]}, {"_id": 0})
    return {"user": user, "site": site}


class ChangePasswordInput(BaseModel):
    current_password: str
    new_password: str


@api_router.post("/auth/change-password")
async def change_password(inp: ChangePasswordInput, user: dict = Depends(get_current_user)):
    if len(inp.new_password) < 6:
        raise HTTPException(400, "Yeni şifre en az 6 karakter olmalı")
    full = await db.users.find_one({"id": user["id"]})
    if not full or not verify_password(inp.current_password, full["password_hash"]):
        raise HTTPException(400, "Mevcut şifre hatalı")
    await db.users.update_one({"id": user["id"]},
                              {"$set": {"password_hash": hash_password(inp.new_password)}})
    await log_audit(user, "password_change", "user", user["id"], {"self": True})
    return {"ok": True}


# ============== AUDIT LOG ==============

class AuditLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    user_id: str
    user_email: str
    action: str  # e.g., "site.create", "user.delete"
    target_type: str  # site, user, payment_method, etc.
    target_id: Optional[str] = None
    target_name: Optional[str] = None
    details: Optional[dict] = None
    site_id: Optional[str] = None


async def log_audit(user: dict, action: str, target_type: str,
                    target_id: Optional[str] = None, details: Optional[dict] = None,
                    target_name: Optional[str] = None, site_id: Optional[str] = None):
    entry = AuditLog(
        user_id=user["id"], user_email=user["email"],
        action=action, target_type=target_type,
        target_id=target_id, target_name=target_name,
        details=details, site_id=site_id,
    )
    try:
        await db.audit_logs.insert_one(entry.model_dump())
    except Exception:
        pass


@api_router.get("/admin/audit-logs")
async def list_audit_logs(
    limit: int = 100,
    offset: int = 0,
    action: Optional[str] = None,
    user_id: Optional[str] = None,
    target_type: Optional[str] = None,
    user: dict = Depends(require_admin),
):
    q = {}
    if action:
        q["action"] = action
    if user_id:
        q["user_id"] = user_id
    if target_type:
        q["target_type"] = target_type
    total = await db.audit_logs.count_documents(q)
    docs = await db.audit_logs.find(q, {"_id": 0}).sort("timestamp", -1).skip(offset).limit(limit).to_list(limit)
    return {"total": total, "items": docs}


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
    await log_audit(user, "site.create", "site", obj.id, target_name=obj.name, details=inp.model_dump(), site_id=obj.id)
    return obj


@api_router.put("/admin/sites/{sid}")
async def update_site(sid: str, inp: SiteInput, user: dict = Depends(require_admin)):
    result = await db.sites.update_one({"id": sid}, {"$set": inp.model_dump()})
    if result.matched_count == 0:
        raise HTTPException(404, "Site bulunamadı")
    await log_audit(user, "site.update", "site", sid, target_name=inp.name, details=inp.model_dump(), site_id=sid)
    return await db.sites.find_one({"id": sid}, {"_id": 0})


@api_router.delete("/admin/sites/{sid}")
async def delete_site(sid: str, user: dict = Depends(require_admin)):
    site = await db.sites.find_one({"id": sid}, {"_id": 0})
    site_name = site["name"] if site else None
    # Cascade delete all site data
    counts = {}
    for coll in ["cash_registers", "payment_methods", "debtors", "transactions", "credits", "expenses", "transfers"]:
        r = await db[coll].delete_many({"site_id": sid})
        counts[coll] = r.deleted_count
    users_deleted = (await db.users.delete_many({"site_id": sid})).deleted_count
    await db.sites.delete_one({"id": sid})
    await log_audit(user, "site.delete", "site", sid, target_name=site_name,
                    details={"cascade": {**counts, "users": users_deleted}}, site_id=sid)
    return {"ok": True}


# ============== ADMIN: SITE CREDITS ==============

@api_router.get("/admin/site-credits")
async def list_site_credits(
    site_id: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    archived: Optional[bool] = False,
    user: dict = Depends(require_admin),
):
    q: dict = {}
    if site_id:
        q["site_id"] = site_id
    if status_filter in ("paid", "unpaid", "partial"):
        q["status"] = status_filter
    # By default exclude archived; if archived=true is passed, return only archived
    if archived:
        q["archived"] = True
    else:
        q["archived"] = {"$ne": True}
    docs = await db.site_credits.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    site_map = {s["id"]: s["name"] for s in await db.sites.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    for d in docs:
        d["site_name"] = site_map.get(d["site_id"], "?")
    return docs


@api_router.post("/admin/site-credits")
async def create_site_credit(inp: SiteCreditInput, user: dict = Depends(require_admin)):
    site = await db.sites.find_one({"id": inp.site_id}, {"_id": 0})
    if not site:
        raise HTTPException(404, "Site bulunamadı")
    if inp.amount <= 0:
        raise HTTPException(400, "Kredi miktarı 0'dan büyük olmalı")
    if inp.commission_pct < 0:
        raise HTTPException(400, "Yüzde 0'dan küçük olamaz")
    debt = round(inp.amount * inp.commission_pct / 100.0, 2)
    obj = SiteCredit(
        site_id=inp.site_id,
        amount=inp.amount,
        commission_pct=inp.commission_pct,
        debt=debt,
        note=inp.note,
        date=inp.date or datetime.now(timezone.utc).date().isoformat(),
        created_by_email=user["email"],
    )
    await db.site_credits.insert_one(obj.model_dump())
    await log_audit(user, "site_credit.create", "site_credit", obj.id,
                    target_name=site["name"], site_id=inp.site_id,
                    details={"amount": inp.amount, "pct": inp.commission_pct, "debt": debt})
    # Fire-and-forget Telegram notification
    await _telegram_send_safe(site, _fmt_credit_created_message(site["name"], obj.model_dump()))
    return {**obj.model_dump(), "site_name": site["name"]}


@api_router.put("/admin/site-credits/{cid}")
async def update_site_credit(cid: str, inp: SiteCreditInput, user: dict = Depends(require_admin)):
    existing = await db.site_credits.find_one({"id": cid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Kredi kaydı bulunamadı")
    site = await db.sites.find_one({"id": inp.site_id}, {"_id": 0, "id": 1, "name": 1})
    if not site:
        raise HTTPException(404, "Site bulunamadı")
    if inp.amount <= 0 or inp.commission_pct < 0:
        raise HTTPException(400, "Geçersiz değer")
    debt = round(inp.amount * inp.commission_pct / 100.0, 2)
    updates = {
        "site_id": inp.site_id,
        "amount": inp.amount,
        "commission_pct": inp.commission_pct,
        "debt": debt,
        "note": inp.note,
        "date": inp.date or existing.get("date"),
    }
    await db.site_credits.update_one({"id": cid}, {"$set": updates})
    await log_audit(user, "site_credit.update", "site_credit", cid,
                    target_name=site["name"], site_id=inp.site_id, details=updates)
    doc = await db.site_credits.find_one({"id": cid}, {"_id": 0})
    doc["site_name"] = site["name"]
    return doc


@api_router.post("/admin/site-credits/{cid}/payments")
async def add_site_credit_payment(cid: str, inp: SiteCreditPaymentInput, user: dict = Depends(require_admin)):
    """Register a payment against a credit. Supports partial payments; auto-updates status."""
    existing = await db.site_credits.find_one({"id": cid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Kredi kaydı bulunamadı")
    if inp.amount <= 0:
        raise HTTPException(400, "Ödeme tutarı 0'dan büyük olmalı")

    debt = float(existing.get("debt", 0))
    prev_paid = float(existing.get("paid_amount", 0))
    new_paid = round(prev_paid + inp.amount, 2)
    if new_paid > debt + 0.01:
        raise HTTPException(400, f"Ödeme miktarı kalan borçtan fazla olamaz. Kalan borç: {round(debt - prev_paid, 2)} ₺")

    payment = {
        "amount": round(inp.amount, 2),
        "date": inp.date or datetime.now(timezone.utc).date().isoformat(),
        "paid_at": datetime.now(timezone.utc).isoformat(),
        "paid_by_email": user["email"],
        "note": inp.note or None,
    }
    new_status = "paid" if new_paid >= debt - 0.01 else "partial"
    updates: dict = {
        "paid_amount": new_paid,
        "status": new_status,
    }
    if new_status == "paid":
        updates["paid_at"] = payment["paid_at"]
        updates["paid_by_email"] = user["email"]
    await db.site_credits.update_one({"id": cid}, {"$set": updates, "$push": {"payments": payment}})
    await log_audit(user, "site_credit.payment", "site_credit", cid,
                    site_id=existing["site_id"],
                    details={"amount": inp.amount, "date": payment["date"], "status": new_status, "paid_total": new_paid})

    doc = await db.site_credits.find_one({"id": cid}, {"_id": 0})
    site = await db.sites.find_one({"id": doc["site_id"]}, {"_id": 0})
    doc["site_name"] = site.get("name") if site else "?"
    # Fire-and-forget Telegram notification
    await _telegram_send_safe(site, _fmt_credit_payment_message(doc["site_name"], doc, payment["amount"], payment["date"]))
    return doc


@api_router.patch("/admin/site-credits/{cid}/status")
async def toggle_site_credit_status(cid: str, status: str = Query(...), user: dict = Depends(require_admin)):
    """Manual status override (e.g. mark whole credit as unpaid to reset). For partial payments use POST /payments."""
    if status not in ("paid", "unpaid"):
        raise HTTPException(400, "status paid veya unpaid olmalı")
    existing = await db.site_credits.find_one({"id": cid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Kredi kaydı bulunamadı")
    updates: dict = {"status": status}
    if status == "paid":
        updates["paid_at"] = datetime.now(timezone.utc).isoformat()
        updates["paid_by_email"] = user["email"]
        updates["paid_amount"] = float(existing.get("debt", 0))
    else:
        updates["paid_at"] = None
        updates["paid_by_email"] = None
        updates["paid_amount"] = 0.0
        updates["payments"] = []
    await db.site_credits.update_one({"id": cid}, {"$set": updates})
    await log_audit(user, "site_credit.status", "site_credit", cid,
                    site_id=existing["site_id"], details={"status": status})
    doc = await db.site_credits.find_one({"id": cid}, {"_id": 0})
    site = await db.sites.find_one({"id": doc["site_id"]}, {"_id": 0, "name": 1})
    doc["site_name"] = site.get("name") if site else "?"
    return doc


@api_router.patch("/admin/site-credits/{cid}/archive")
async def archive_site_credit(cid: str, archived: bool = Query(True), user: dict = Depends(require_admin)):
    """Toggle archive flag on a credit record. Archived records are hidden from default lists and dashboard."""
    existing = await db.site_credits.find_one({"id": cid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Kredi kaydı bulunamadı")
    updates: dict = {"archived": archived}
    if archived:
        updates["archived_at"] = datetime.now(timezone.utc).isoformat()
        updates["archived_by_email"] = user["email"]
    else:
        updates["archived_at"] = None
        updates["archived_by_email"] = None
    await db.site_credits.update_one({"id": cid}, {"$set": updates})
    await log_audit(user, "site_credit.archive" if archived else "site_credit.unarchive",
                    "site_credit", cid, site_id=existing["site_id"],
                    details={"archived": archived})
    doc = await db.site_credits.find_one({"id": cid}, {"_id": 0})
    site = await db.sites.find_one({"id": doc["site_id"]}, {"_id": 0, "name": 1})
    doc["site_name"] = site.get("name") if site else "?"
    return doc


@api_router.post("/admin/site-credits/send-reminders")
async def trigger_credit_reminders(user: dict = Depends(require_admin)):
    """Manually trigger credit reminders for all sites (same task as daily 10:00 job)."""
    result = await _send_all_credit_reminders()
    await log_audit(user, "site_credit.reminders_sent", "system", "reminders", details=result)
    return result


@api_router.delete("/admin/site-credits/{cid}")
async def delete_site_credit(cid: str, user: dict = Depends(require_admin)):
    existing = await db.site_credits.find_one({"id": cid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Kredi kaydı bulunamadı")
    await db.site_credits.delete_one({"id": cid})
    await log_audit(user, "site_credit.delete", "site_credit", cid,
                    site_id=existing["site_id"], details={"amount": existing.get("amount")})
    return {"ok": True}


@api_router.get("/site-credits/mine")
async def list_my_site_credits(user: dict = Depends(get_current_user), site_id: Optional[str] = None):
    """Read-only list of the current (or admin-viewed) site's credits. Excludes archived."""
    if user.get("platform_role") == "admin":
        sid = site_id
    else:
        sid = user.get("site_id")
    if not sid:
        return []
    docs = await db.site_credits.find(
        {"site_id": sid, "archived": {"$ne": True}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    for c in docs:
        c.setdefault("paid_amount", 0.0 if c.get("status") != "paid" else float(c.get("debt", 0)))
        c.setdefault("payments", [])
        c["remaining_debt"] = max(0.0, round(float(c.get("debt", 0)) - float(c.get("paid_amount", 0)), 2))
    return docs




# ============== ADMIN: USERS ==============

@api_router.get("/admin/users")
async def list_users(user: dict = Depends(require_admin)):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0, "totp_secret": 0}).sort("created_at", 1).to_list(1000)
    return docs


@api_router.post("/admin/users")
async def create_user(inp: UserCreateInput, user: dict = Depends(require_admin)):
    email = inp.email.strip().lower()
    if "@" not in email or len(email) < 5:
        raise HTTPException(400, "Geçerli bir e-posta girin")
    if len(inp.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"Şifre en az {MIN_PASSWORD_LENGTH} karakter olmalı")
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
    await log_audit(user, "user.create", "user", obj.id, target_name=obj.email,
                    details={"platform_role": obj.platform_role, "site_role": obj.site_role},
                    site_id=obj.site_id)
    return d


@api_router.put("/admin/users/{uid_}")
async def update_user(uid_: str, inp: UserUpdateInput, user: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": uid_}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "Kullanıcı bulunamadı")
    update = {}
    changes = []
    if inp.name is not None and inp.name != target.get("name"):
        update["name"] = inp.name
        changes.append("name")
    if inp.password:
        if len(inp.password) < MIN_PASSWORD_LENGTH:
            raise HTTPException(400, f"Şifre en az {MIN_PASSWORD_LENGTH} karakter olmalı")
        update["password_hash"] = hash_password(inp.password)
        changes.append("password")
    if inp.active is not None and inp.active != target.get("active"):
        update["active"] = inp.active
        changes.append(f"active={inp.active}")
    if inp.site_role is not None and inp.site_role != target.get("site_role"):
        update["site_role"] = inp.site_role
        changes.append(f"site_role={inp.site_role}")
    if update:
        await db.users.update_one({"id": uid_}, {"$set": update})
        await log_audit(user, "user.update", "user", uid_, target_name=target["email"],
                        details={"changes": changes}, site_id=target.get("site_id"))
    return await db.users.find_one({"id": uid_}, {"_id": 0, "password_hash": 0})


@api_router.delete("/admin/users/{uid_}")
async def delete_user(uid_: str, user: dict = Depends(require_admin)):
    if uid_ == user["id"]:
        raise HTTPException(400, "Kendinizi silemezsiniz")
    target = await db.users.find_one({"id": uid_}, {"_id": 0})
    await db.users.delete_one({"id": uid_})
    if target:
        await log_audit(user, "user.delete", "user", uid_, target_name=target.get("email"),
                        site_id=target.get("site_id"))
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

    # Site Credit debt aggregation (admin-managed credits given by Playspintech to this site)
    sc_docs = await db.site_credits.find({"site_id": target_site, "archived": {"$ne": True}}, {"_id": 0}).sort("created_at", -1).to_list(500)
    # normalize legacy records that may lack paid_amount / payments
    for c in sc_docs:
        c.setdefault("paid_amount", 0.0 if c.get("status") != "paid" else float(c.get("debt", 0)))
        c.setdefault("payments", [])
        c["remaining_debt"] = max(0.0, round(float(c.get("debt", 0)) - float(c.get("paid_amount", 0)), 2))
    sc_open = [c for c in sc_docs if c.get("status") != "paid"]
    sc_paid = [c for c in sc_docs if c.get("status") == "paid"]
    site_credit_summary = {
        "unpaid_debt": round(sum(c["remaining_debt"] for c in sc_open), 2),
        "unpaid_count": len(sc_open),
        "paid_count": len(sc_paid),
        "total_count": len(sc_docs),
        "recent": sc_docs[:5],
    }

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
        "site_credit": site_credit_summary,
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

    # Enrich with lookup data
    site_q = {"site_id": q["site_id"]} if "site_id" in q else {}
    pms = await db.payment_methods.find(site_q, {"_id": 0}).sort("order", 1).to_list(1000)
    kasalar = await db.cash_registers.find(site_q, {"_id": 0}).to_list(1000)
    kasa_map = {k["id"]: k["name"] for k in kasalar}
    pm_map = {p["id"]: p for p in pms}

    # Build per-payment-method rows in the site's configured order (include zero rows)
    tx_by_pm = {t["payment_method_id"]: t for t in txs}
    pm_rows = []
    for pm in pms:
        t = tx_by_pm.get(pm["id"])
        pm_rows.append({
            "payment_method_id": pm["id"],
            "name": pm["name"],
            "deposit": t["deposit"] if t else 0.0,
            "withdrawal": t["withdrawal"] if t else 0.0,
            "commission": t["commission"] if t else 0.0,
            "net": t["net"] if t else 0.0,
        })

    # Enrich transfers with kasa names
    for t in trs:
        t["from_name"] = kasa_map.get(t["from_cash_register_id"], "?")
        t["to_name"] = kasa_map.get(t["to_cash_register_id"], "?")

    # Enrich expenses with kasa names
    for e in exps:
        e["cash_register_name"] = kasa_map.get(e["cash_register_id"], "-")

    return {
        "date": date_str,
        "summary": {**tx_agg, "expense": ex, "credit_added": cr["added"], "credit_paid": cr["paid"], "profit_loss": round(tx_agg["net"] - ex, 2)},
        "transactions": txs,
        "expenses": exps,
        "credits": creds,
        "transfers": trs,
        "payment_method_rows": pm_rows,
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


# ============== SEED / DEFAULT DATA ==============

async def _seed_default_site_data(site_id: str):
    kasalar = [
        ("BP KASA", 1),
        ("MULTİPAY KASA", 2),
        ("PAYLUX KASA", 3),
        ("JET KASA", 4),
        ("NEO KASA", 5),
        ("KARTAL KASA", 6),
        ("MARCO KASA", 7),
    ]
    kasa_ids = {}
    for name, order in kasalar:
        obj = CashRegister(site_id=site_id, name=name, type="main", order=order)
        await db.cash_registers.insert_one(obj.model_dump())
        kasa_ids[name] = obj.id

    methods = [
        # (name, kasa, deposit_pct, withdrawal_pct)
        ("BP HAVALE",         "BP KASA",       7,    0),
        ("MULTİPAY BANKPAY",  "MULTİPAY KASA", 5,    5),
        ("MULTİPAY BANKİN",   "MULTİPAY KASA", 5,    5),
        ("MULTİPAY PAPARA",   "MULTİPAY KASA", 6.5,  1),
        ("PAYLUX HAVALE",     "PAYLUX KASA",   3.5,  3),
        ("PAYLUX KRİPTO",     "PAYLUX KASA",   2.5,  0.5),
        ("JET HAVALE",        "JET KASA",      5,    0),
        ("JET KRİPTO",        "JET KASA",      2,    2),
        ("JET QR",            "JET KASA",      7,    1),
        ("JET KREDİ KARTI",   "JET KASA",      12,   0),
        ("NEO HAVALE",        "NEO KASA",      6,    1),
        ("NEO KRİPTO",        "NEO KASA",      2,    2),
    ]
    for i, (name, kasa, dep, wd) in enumerate(methods):
        obj = PaymentMethod(site_id=site_id, name=name,
                            cash_register_id=kasa_ids[kasa],
                            deposit_commission_pct=dep,
                            withdrawal_commission_pct=wd, order=i)
        await db.payment_methods.insert_one(obj.model_dump())


@api_router.post("/admin/sites/{sid}/seed-defaults")
async def seed_defaults(sid: str, user: dict = Depends(require_admin)):
    site = await db.sites.find_one({"id": sid})
    if not site:
        raise HTTPException(404, "Site bulunamadı")
    existing = await db.cash_registers.count_documents({"site_id": sid})
    if existing > 0:
        raise HTTPException(400, "Bu sitede zaten veri var")
    await _seed_default_site_data(sid)
    await log_audit(user, "site.seed_defaults", "site", sid, target_name=site.get("name"), site_id=sid)
    return {"ok": True}


# ============== TELEGRAM ==============

@api_router.get("/site/telegram-config")
async def get_telegram_config(user: dict = Depends(get_current_user)):
    """Site user or admin (with adminSiteId override) fetches current telegram config."""
    if user.get("platform_role") == "admin":
        raise HTTPException(400, "Admin bu endpoint'i kullanamaz. Admin Panel'den site düzenleyin.")
    site = await db.sites.find_one({"id": user["site_id"]}, {"_id": 0})
    if not site:
        raise HTTPException(404, "Site bulunamadı")
    return {
        "telegram_bot_token": site.get("telegram_bot_token") or "",
        "telegram_chat_id": site.get("telegram_chat_id") or "",
        "configured": bool(site.get("telegram_bot_token") and site.get("telegram_chat_id")),
    }


@api_router.put("/site/telegram-config")
async def update_telegram_config(inp: TelegramConfigInput, user: dict = Depends(get_current_user)):
    if user.get("platform_role") == "admin":
        raise HTTPException(400, "Admin bu endpoint'i kullanamaz. Admin Panel'den site düzenleyin.")
    sid = user["site_id"]
    update = {
        "telegram_bot_token": (inp.telegram_bot_token or "").strip() or None,
        "telegram_chat_id": (inp.telegram_chat_id or "").strip() or None,
    }
    await db.sites.update_one({"id": sid}, {"$set": update})
    await log_audit(user, "site.telegram_config", "site", sid, site_id=sid,
                    details={"configured": bool(update["telegram_bot_token"] and update["telegram_chat_id"])})
    return {"ok": True}


def _fmt_try(n: float) -> str:
    """Turkish TRY formatting."""
    try:
        s = f"{float(n):,.2f}"
        # 1,234.56 → 1.234,56
        return s.replace(",", "X").replace(".", ",").replace("X", ".") + " ₺"
    except Exception:
        return f"{n} ₺"


def _fmt_daily_message(site_name: str, date_str: str, data: dict) -> str:
    s = data["summary"]
    pm_rows = data.get("payment_method_rows", [])
    total_dep = sum(r["deposit"] for r in pm_rows)
    total_wd = sum(r["withdrawal"] for r in pm_rows)
    total_com = sum(r["commission"] for r in pm_rows)
    total_net = sum(r["net"] for r in pm_rows)
    member_delta = total_dep - total_wd
    manuel_added = s.get("credit_added") or 0
    manuel_paid = s.get("credit_paid") or 0
    manuel_delta = manuel_added - manuel_paid
    expense = s.get("expense") or 0
    pnl = s.get("profit_loss", 0)

    L = []
    L.append(f"📊 *{site_name}* — Günlük Rapor")
    L.append(f"🗓️ {date_str}")
    L.append("")

    # ── Site Üyeleri ──
    L.append("👥 *SİTE ÜYELERİ*")
    L.append(f"  📈 Site Üyeleri Yatırım:  `{_fmt_try(total_dep)}`")
    L.append(f"  📉 Site Üyeleri Çekim:  `{_fmt_try(total_wd)}`")
    L.append(f"  💸 Toplam Ödenen Komisyon:  `{_fmt_try(total_com)}`")
    L.append(f"  🏦 Site Üyeleri Günlük Kalan:  `{_fmt_try(total_net)}`")
    L.append(f"  ⚖️ Üyeler Yatırım-Çekim Farkı:  `{_fmt_try(member_delta)}`")
    L.append("")

    # ── Manueller ──
    L.append("🪙 *MANUELLER*")
    L.append(f"  ➕ Eklenen Manuel Toplamı:  `{_fmt_try(manuel_added)}`")
    L.append(f"  ➖ Ödenen Manuel Toplamı:  `{_fmt_try(manuel_paid)}`")
    L.append(f"  ⚖️ Manueller Fark:  `{_fmt_try(manuel_delta)}`")
    L.append("")

    # ── Site Toplamları ──
    L.append("💼 *SİTE TOPLAMLARI*")
    L.append(f"  📈 Toplam Site Yatırım:  `{_fmt_try(total_dep)}`")
    L.append(f"  📉 Toplam Site Çekim:  `{_fmt_try(total_wd)}`")
    L.append(f"  🧾 Yapılan Ödemeler:  `{_fmt_try(expense)}`")
    L.append("")

    # ── Kasalar Arası Transfer ──
    transfers = data.get("transfers", [])
    L.append("🔄 *KASALAR ARASI TRANSFER*")
    if transfers:
        for t in transfers:
            frm = t.get("from_name", "?")
            to = t.get("to_name", "?")
            L.append(f"  🔁 {frm} → {to}:  `{_fmt_try(t['amount'])}`")
    else:
        L.append("  _Transfer yok_")
    L.append("")

    # ── Yapılan Ödemeler ──
    expenses = data.get("expenses", [])
    L.append("🧾 *YAPILAN ÖDEMELER*")
    if expenses:
        for e in expenses:
            desc = (e.get("description") or "").replace("*", "").replace("_", "").replace("`", "")[:40]
            kasa = e.get("cash_register_name", "-")
            L.append(f"  • {desc} — {kasa}:  `{_fmt_try(e['amount'])}`")
    else:
        L.append("  _Ödeme yok_")
    L.append("")

    # ── Sonuç ──
    icon = "🟢" if pnl >= 0 else "🔴"
    L.append("🏛️ *SONUÇ*")
    L.append(f"  {icon} *Toplam Kar / Zarar:*  `{_fmt_try(pnl)}`")

    return "\n".join(L)


def _fmt_kasalar_message(site_name: str, balances: list) -> str:
    """Compact Kasalar snapshot for Telegram — one line per kasa + total."""
    L = []
    L.append(f"🏦 *{site_name}* — Kasalar")
    L.append("")
    if not balances:
        L.append("_Kasa yok_")
        return "\n".join(L)

    total = 0.0
    for b in balances:
        current = float(b.get("balance") or 0)
        icon = "🟢" if current >= 0 else "🔴"
        name = (b.get("name") or "?").replace("*", "").replace("_", "").replace("`", "")
        L.append(f"{icon} {name}:  `{_fmt_try(current)}`")
        total += current

    L.append("")
    total_icon = "🟢" if total >= 0 else "🔴"
    L.append(f"{total_icon} *Toplam:*  `{_fmt_try(total)}`")
    return "\n".join(L)


async def _telegram_send_safe(site: dict, text: str) -> None:
    """Fire-and-forget Telegram send. Silently returns on missing config or error."""
    token = (site or {}).get("telegram_bot_token")
    chat_id = (site or {}).get("telegram_chat_id")
    if not token or not chat_id:
        return
    import httpx
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(url, json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "Markdown",
                "disable_web_page_preview": True,
            })
    except Exception as e:
        logging.warning(f"Telegram send failed for site {site.get('id')}: {e}")


def _fmt_credit_created_message(site_name: str, credit: dict) -> str:
    L = [f"💳 *{site_name}* — Yeni Kredi Tanımlandı", ""]
    L.append(f"📅 Tarih: `{credit.get('date')}`")
    L.append(f"💰 Kredi Miktarı: `{_fmt_try(credit.get('amount', 0))}`")
    L.append(f"🧾 Oluşan Borç: `{_fmt_try(credit.get('debt', 0))}`")
    if credit.get("note"):
        L.append(f"📝 Not: _{credit['note']}_")
    return "\n".join(L)


def _fmt_credit_payment_message(site_name: str, credit: dict, payment_amount: float, payment_date: str) -> str:
    debt = float(credit.get("debt", 0))
    paid = float(credit.get("paid_amount", 0))
    remaining = max(0.0, round(debt - paid, 2))
    L = [f"✅ *{site_name}* — Kredi Ödemesi Alındı", ""]
    L.append(f"📅 Ödeme Tarihi: `{payment_date}`")
    L.append(f"💵 Ödenen Tutar: `{_fmt_try(payment_amount)}`")
    L.append(f"🧾 Toplam Borç: `{_fmt_try(debt)}`")
    L.append(f"📥 Toplam Ödenmiş: `{_fmt_try(paid)}`")
    if remaining <= 0:
        L.append(f"🟢 *Kalan Borç:* `{_fmt_try(0)}` — Kredi tamamen ödendi ✔")
    else:
        L.append(f"🔴 *Kalan Borç:* `{_fmt_try(remaining)}`")
    return "\n".join(L)


def _fmt_credit_reminder_message(site_name: str, unpaid: list) -> str:
    """Daily reminder for a site's unpaid + partial credits."""
    L = [f"⏰ *{site_name}* — Ödenmemiş Kredi Hatırlatması", ""]
    total_remaining = 0.0
    for c in unpaid:
        debt = float(c.get("debt", 0))
        paid = float(c.get("paid_amount", 0))
        remaining = max(0.0, round(debt - paid, 2))
        total_remaining += remaining
        tag = "🟡 KISMI" if c.get("status") == "partial" else "🔴 ÖDENMEDİ"
        L.append(f"• `{c.get('date')}` · Kredi `{_fmt_try(c.get('amount', 0))}`")
        L.append(f"  Borç `{_fmt_try(debt)}` · Ödenmiş `{_fmt_try(paid)}` · Kalan `{_fmt_try(remaining)}`  {tag}")
    L.append("")
    L.append("━━━━━━━━━━━━━━━━━━━")
    L.append(f"💰 *Toplam Kalan Borç:*  `{_fmt_try(round(total_remaining, 2))}`")
    L.append("_Playspintech tarafından günlük otomatik hatırlatma._")
    return "\n".join(L)


async def _send_all_credit_reminders() -> dict:
    """Send unpaid-credit reminder to every site with Telegram configured + open credits."""
    sites = await db.sites.find({
        "telegram_bot_token": {"$nin": [None, ""]},
        "telegram_chat_id": {"$nin": [None, ""]},
    }, {"_id": 0}).to_list(500)
    sent = 0
    skipped = 0
    for site in sites:
        docs = await db.site_credits.find({
            "site_id": site["id"],
            "archived": {"$ne": True},
            "status": {"$in": ["unpaid", "partial"]},
        }, {"_id": 0}).sort("created_at", 1).to_list(500)
        if not docs:
            skipped += 1
            continue
        try:
            await _telegram_send_safe(site, _fmt_credit_reminder_message(site["name"], docs))
            sent += 1
        except Exception as e:
            logging.warning(f"[reminder] Send failed for site {site.get('id')}: {e}")
    return {"sent": sent, "skipped_no_debt": skipped, "total_configured_sites": len(sites)}


async def _daily_reminder_loop():
    """Background task: send reminders once per day at 10:00 Europe/Istanbul (07:00 UTC)."""
    while True:
        try:
            now = datetime.now(timezone.utc)
            target = now.replace(hour=7, minute=0, second=0, microsecond=0)
            if target <= now:
                target = target + timedelta(days=1)
            sleep_sec = (target - now).total_seconds()
            logging.info(f"[reminder] Next daily reminder in {int(sleep_sec / 60)} min at {target.isoformat()}")
            await asyncio.sleep(sleep_sec)
            result = await _send_all_credit_reminders()
            logging.info(f"[reminder] Sent: {result}")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logging.error(f"[reminder] Loop error: {e}")
            await asyncio.sleep(300)  # retry in 5 min








@api_router.post("/reports/daily/send-telegram")
async def send_daily_telegram(date_str: str = Query(..., alias="date"),
                              site_id: Optional[str] = None,
                              user: dict = Depends(get_current_user)):
    """Fetch daily report and send stat blocks (right column) to configured Telegram group."""
    sid = _resolve_target_site(user, site_id)
    site = await db.sites.find_one({"id": sid}, {"_id": 0})
    if not site:
        raise HTTPException(404, "Site bulunamadı")
    token = site.get("telegram_bot_token")
    chat_id = site.get("telegram_chat_id")
    if not token or not chat_id:
        raise HTTPException(400, "Bu site için Telegram bot token'ı ve grup ID'si tanımlı değil. Ayarlar → Telegram bölümünden ekleyin.")

    data = await report_daily(date_str, site_id, user)
    msg = _fmt_daily_message(site["name"], date_str, data)

    # Send via Telegram HTTP API
    import httpx
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json={
                "chat_id": chat_id,
                "text": msg,
                "parse_mode": "Markdown",
                "disable_web_page_preview": True,
            })
            if resp.status_code != 200:
                body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {"text": resp.text}
                desc = body.get("description", "Telegram API hatası")
                raise HTTPException(502, f"Telegram: {desc}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Telegram bağlantı hatası: {e}")

    await log_audit(user, "telegram.send_daily", "site", sid,
                    site_id=sid, details={"date": date_str})
    return {"ok": True}


@api_router.get("/reports/daily/telegram-preview")
async def preview_daily_telegram(date_str: str = Query(..., alias="date"),
                                 site_id: Optional[str] = None,
                                 user: dict = Depends(get_current_user)):
    """Return the formatted daily Telegram message without sending."""
    sid = _resolve_target_site(user, site_id)
    site = await db.sites.find_one({"id": sid}, {"_id": 0})
    if not site:
        raise HTTPException(404, "Site bulunamadı")
    data = await report_daily(date_str, site_id, user)
    msg = _fmt_daily_message(site["name"], date_str, data)
    return {"message": msg, "configured": bool(site.get("telegram_bot_token") and site.get("telegram_chat_id"))}


@api_router.post("/kasalar/send-telegram")
async def send_kasalar_telegram(site_id: Optional[str] = None,
                                user: dict = Depends(get_current_user)):
    """Send current Kasalar snapshot to the site's configured Telegram group."""
    sid = _resolve_target_site(user, site_id)
    site = await db.sites.find_one({"id": sid}, {"_id": 0})
    if not site:
        raise HTTPException(404, "Site bulunamadı")
    token = site.get("telegram_bot_token")
    chat_id = site.get("telegram_chat_id")
    if not token or not chat_id:
        raise HTTPException(400, "Bu site için Telegram bot token'ı ve grup ID'si tanımlı değil. Ayarlar → Telegram bölümünden ekleyin.")

    balances = await compute_balances_for_site(sid)
    msg = _fmt_kasalar_message(site["name"], balances)

    import httpx
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json={
                "chat_id": chat_id,
                "text": msg,
                "parse_mode": "Markdown",
                "disable_web_page_preview": True,
            })
            if resp.status_code != 200:
                body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {"text": resp.text}
                desc = body.get("description", "Telegram API hatası")
                raise HTTPException(502, f"Telegram: {desc}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Telegram bağlantı hatası: {e}")

    await log_audit(user, "telegram.send_kasalar", "site", sid,
                    site_id=sid, details={"count": len(balances)})
    return {"ok": True}


@api_router.get("/kasalar/telegram-preview")
async def preview_kasalar_telegram(site_id: Optional[str] = None,
                                   user: dict = Depends(get_current_user)):
    """Return the formatted Kasalar Telegram message without sending."""
    sid = _resolve_target_site(user, site_id)
    site = await db.sites.find_one({"id": sid}, {"_id": 0})
    if not site:
        raise HTTPException(404, "Site bulunamadı")
    balances = await compute_balances_for_site(sid)
    msg = _fmt_kasalar_message(site["name"], balances)
    return {"message": msg, "configured": bool(site.get("telegram_bot_token") and site.get("telegram_chat_id"))}


# ============== ROLLOVERS (Aylık Devir) ==============

class RolloverInput(BaseModel):
    year: int
    month: int
    note: Optional[str] = None


def _resolve_target_site(user: dict, site_id: Optional[str]) -> str:
    if user.get("platform_role") == "admin":
        if not site_id:
            raise HTTPException(400, "Admin için site_id gerekli")
        return site_id
    return user["site_id"]


@api_router.get("/rollovers")
async def list_rollovers(
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = scope_filter(user, _site_id_query_param(user, site_id))
    docs = await db.rollovers.find(q, {"_id": 0}).sort([("year", -1), ("month", -1)]).to_list(500)
    return docs


@api_router.get("/rollovers/{rid}")
async def get_rollover(rid: str, user: dict = Depends(get_current_user)):
    q = {"id": rid, **scope_filter(user)}
    doc = await db.rollovers.find_one(q, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Devir kaydı bulunamadı")
    return doc


@api_router.post("/rollovers")
async def create_rollover(
    inp: RolloverInput,
    site_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    sid = _resolve_target_site(user, site_id)
    if not (1 <= inp.month <= 12):
        raise HTTPException(400, "Geçersiz ay")

    # Duplicate check
    exists = await db.rollovers.find_one({"site_id": sid, "year": inp.year, "month": inp.month})
    if exists:
        raise HTTPException(400, f"{inp.year}-{inp.month:02d} devri zaten alınmış")

    _, last = monthrange(inp.year, inp.month)
    d_from = date(inp.year, inp.month, 1).isoformat()
    d_to = date(inp.year, inp.month, last).isoformat()

    # Aggregate month's summary
    q = {"site_id": sid, "date": {"$gte": d_from, "$lte": d_to}}
    tx = {"deposit": 0.0, "withdrawal": 0.0, "commission": 0.0, "net": 0.0}
    async for row in db.transactions.aggregate([{"$match": q}, {"$group": {
        "_id": None, "deposit": {"$sum": "$deposit"}, "withdrawal": {"$sum": "$withdrawal"},
        "commission": {"$sum": "$commission"}, "net": {"$sum": "$net"}}}]):
        tx = row
    ex_total = 0.0
    async for row in db.expenses.aggregate([{"$match": q}, {"$group": {"_id": None, "total": {"$sum": "$amount"}}}]):
        ex_total = row["total"]
    cr = {"added": 0.0, "paid": 0.0}
    async for row in db.credits.aggregate([{"$match": q}, {"$group": {"_id": None, "added": {"$sum": "$added"}, "paid": {"$sum": "$paid"}}}]):
        cr = row

    summary = {
        "deposit": tx["deposit"], "withdrawal": tx["withdrawal"],
        "commission": tx["commission"], "net": tx["net"],
        "expense": ex_total,
        "credit_added": cr["added"], "credit_paid": cr["paid"],
        "profit_loss": round(tx["net"] - ex_total, 2),
    }

    # Balance snapshots (current live balance)
    balances = await compute_balances_for_site(sid)
    kasa_snapshots = []
    for b in balances:
        kasa_snapshots.append({
            "id": b["id"], "name": b["name"],
            "opening_balance": b["initial_balance"],
            "closing_balance": b["balance"],
            "delta": round(b["balance"] - b["initial_balance"], 2),
        })
    total_cash = round(sum(b["balance"] for b in balances), 2)

    # Debtor snapshots (per debtor: initial + credits_added - credits_paid up to end of month)
    debtors = await db.debtors.find({"site_id": sid}, {"_id": 0}).to_list(1000)
    debtor_snapshots = []
    for d in debtors:
        added = 0.0
        paid = 0.0
        async for c in db.credits.find({"site_id": sid, "debtor_id": d["id"], "date": {"$lte": d_to}}, {"_id": 0}):
            added += c.get("added", 0.0)
            paid += c.get("paid", 0.0)
        debtor_snapshots.append({
            "id": d["id"], "name": d["name"],
            "balance": round(d.get("initial_balance", 0.0) + added - paid, 2),
        })

    obj = MonthlyRollover(
        site_id=sid, year=inp.year, month=inp.month,
        closed_by_user_id=user["id"],
        closed_by_email=user["email"],
        summary=summary,
        kasa_snapshots=kasa_snapshots,
        debtor_snapshots=debtor_snapshots,
        total_cash_at_close=total_cash,
        note=inp.note,
    )

    # Roll cash forward: update each kasa's initial_balance to include this month's delta,
    # then delete this month's transactions/expenses/credits/transfers so next month starts fresh
    # with the carried-forward balance in initial_balance.
    for ks in kasa_snapshots:
        await db.cash_registers.update_one(
            {"id": ks["id"], "site_id": sid},
            {"$set": {"initial_balance": ks["closing_balance"]}}
        )
    # Update debtor initial balances to their computed month-end values
    for ds in debtor_snapshots:
        await db.debtors.update_one(
            {"id": ds["id"], "site_id": sid},
            {"$set": {"initial_balance": ds["balance"]}}
        )
    # Delete this month's live transactional data (archived in the rollover snapshot)
    await db.transactions.delete_many(q)
    await db.expenses.delete_many(q)
    await db.credits.delete_many(q)
    await db.transfers.delete_many(q)

    await db.rollovers.insert_one(obj.model_dump())
    await log_audit(user, "rollover.create", "rollover", obj.id,
                    target_name=f"{inp.year}-{inp.month:02d}",
                    details={"total_cash": total_cash, "profit_loss": summary["profit_loss"]},
                    site_id=sid)
    return obj


@api_router.delete("/rollovers/{rid}")
async def delete_rollover(rid: str, user: dict = Depends(require_admin)):
    """Sadece admin, yanlış alınan bir devri silebilir. Silme sadece snapshot'ı siler;
    zaten silinmiş olan geçmiş ay verilerini geri getirmez."""
    doc = await db.rollovers.find_one({"id": rid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Devir kaydı bulunamadı")
    await db.rollovers.delete_one({"id": rid})
    await log_audit(user, "rollover.delete", "rollover", rid,
                    target_name=f"{doc['year']}-{doc['month']:02d}",
                    site_id=doc.get("site_id"))
    return {"ok": True}


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
    await db.audit_logs.create_index([("timestamp", -1)])
    await db.audit_logs.create_index("user_id")
    await db.rollovers.create_index([("site_id", 1), ("year", -1), ("month", -1)])
    try:
        await seed_admin_and_migrate()
    except Exception as e:
        logger.error(f"Seed/migrate hatası: {e}")

    # Start daily credit-reminder background task
    app.state.reminder_task = asyncio.create_task(_daily_reminder_loop())


@app.on_event("shutdown")
async def shutdown_db_client():
    task = getattr(app.state, "reminder_task", None)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    client.close()

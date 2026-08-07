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
from typing import List, Optional, Literal, Dict
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
    type: Optional[Literal["online", "sokak"]] = None
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
    paid_amount: float = 0.0  # kümülatif ödenen miktar (TL)
    payments: List[dict] = Field(default_factory=list)  # [{amount, date, paid_at, paid_by_email, note?, amount_usd?, exchange_rate?, paid_currency?}]
    note: Optional[str] = None
    status: str = "unpaid"  # "unpaid" | "partial" | "paid"
    archived: bool = False
    # USD carry-over (locked at creation)
    exchange_rate: Optional[float] = None  # TL/USD rate at creation
    amount_usd: Optional[float] = None     # verilen kredi USD karşılığı (creation rate)
    debt_usd: Optional[float] = None       # borç USD karşılığı
    paid_amount_usd: float = 0.0           # kümülatif ödenen USD karşılığı
    date: str = Field(default_factory=lambda: datetime.now(timezone.utc).date().isoformat())
    paid_at: Optional[str] = None  # borç tamamen ödendiği zaman
    paid_by_email: Optional[str] = None
    archived_at: Optional[str] = None
    archived_by_email: Optional[str] = None
    created_by_email: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# Partner kasas — sabit 4 kasa
PARTNER_KASAS = ["Playspintech", "Harry", "Bozo", "Memo"]


class PartnerKasaMovement(BaseModel):
    """Ortak kasası hareketi — kredi ödemesi girişi veya çekim çıkışı."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=uid)
    kasa: str  # "Playspintech" | "Harry" | "Bozo" | "Memo"
    type: str  # "credit_payment" | "withdrawal" | "adjustment" | "backfill"
    amount: float  # pozitif giriş, negatif çıkış
    site_credit_id: Optional[str] = None
    site_id: Optional[str] = None
    payment_ref: Optional[str] = None
    note: Optional[str] = None
    date: str = Field(default_factory=lambda: datetime.now(timezone.utc).date().isoformat())
    created_by_email: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class PartnerWithdrawInput(BaseModel):
    amount: float
    date: Optional[str] = None
    note: Optional[str] = None


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
    type: Optional[Literal["online", "sokak"]] = None
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None


class SetupInput(BaseModel):
    """Yeni site kurulumu: site + varsayılan kasalar/ödeme yöntemleri + ilk kredi + opsiyonel kurulum ücreti."""
    name: str
    type: Literal["online", "sokak"]
    amount: float
    commission_pct: float = 0.0
    setup_fee: float = 0.0  # Playspintech admin kazancı (0 ise atlanır)
    setup_fee_partner_name: Optional[str] = None  # setup_fee>0 ise zorunlu
    note: Optional[str] = None
    exchange_rate: Optional[float] = None


class TelegramConfigInput(BaseModel):
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None


DEFAULT_NOTIFICATION_PREFS = {
    "partner_movement": True,
    "site_credit_created": True,
    "site_credit_paid": True,
    "site_setup": True,
    "admin_payment_created": True,
    "daily_digest": True,
}


class AdminNotificationConfigInput(BaseModel):
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    notification_prefs: Optional[Dict[str, bool]] = None


class AdminPaymentInput(BaseModel):
    date: str
    description: str
    amount: float
    partner_name: str  # required — Ödeme hangi ortak kasadan düşülecek
    category: Optional[str] = None
    note: Optional[str] = None
    exchange_rate: Optional[float] = None


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
    exchange_rate: Optional[float] = None  # TL/USD; if omitted uses admin_settings.usd_rate


class SiteCreditPaymentInput(BaseModel):
    amount: float  # in the chosen currency (TL veya USD)
    date: Optional[str] = None
    note: Optional[str] = None
    splits: Optional[List[dict]] = None  # [{kasa: str, amount: float}] — amounts in TRY
    paid_currency: Optional[Literal["TRY", "USD"]] = "TRY"
    exchange_rate: Optional[float] = None


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
    # USD carry-over
    rate = float(inp.exchange_rate) if (inp.exchange_rate and inp.exchange_rate > 0) else await _get_current_usd_rate()
    amount_usd = round(inp.amount / rate, 2)
    debt_usd = round(debt / rate, 2)
    obj = SiteCredit(
        site_id=inp.site_id,
        amount=inp.amount,
        commission_pct=inp.commission_pct,
        debt=debt,
        exchange_rate=rate,
        amount_usd=amount_usd,
        debt_usd=debt_usd,
        note=inp.note,
        date=inp.date or datetime.now(timezone.utc).date().isoformat(),
        created_by_email=user["email"],
    )
    await db.site_credits.insert_one(obj.model_dump())
    await log_audit(user, "site_credit.create", "site_credit", obj.id,
                    target_name=site["name"], site_id=inp.site_id,
                    details={"amount": inp.amount, "pct": inp.commission_pct, "debt": debt,
                             "exchange_rate": rate, "amount_usd": amount_usd, "debt_usd": debt_usd})
    # Fire-and-forget Telegram notifications (site-scoped + admin-global)
    await _telegram_send_safe(site, _fmt_credit_created_message(site["name"], obj.model_dump()))
    admin_msg = (
        "*Playspintech — Yeni Kredi Açıldı*\n"
        f"_Site:_ *{site['name']}*\n"
        f"_Kredi:_ ₺{_amt(float(inp.amount))} (≈ ${_amt(amount_usd)})"
        + (f" · Komisyon: %{inp.commission_pct:g} (Borç: ₺{_amt(debt)} ≈ ${_amt(debt_usd)})" if inp.commission_pct else "")
        + f"\n_Kur:_ `1 USD = {_amt(rate)} TRY`"
    )
    if inp.note:
        admin_msg += f"\n_Not:_ {inp.note}"
    await _admin_notify("site_credit_created", admin_msg)
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

    # Determine currency + rate
    paid_currency = (inp.paid_currency or "TRY").upper()
    if paid_currency not in ("TRY", "USD"):
        paid_currency = "TRY"
    # Use debt's locked exchange_rate for USD→TRY conversion (so USD debt is fixed).
    credit_rate = float(existing.get("exchange_rate") or 0.0)
    if credit_rate <= 0:
        credit_rate = await _get_current_usd_rate()  # legacy credits without exchange_rate
    payment_rate = float(inp.exchange_rate) if (inp.exchange_rate and inp.exchange_rate > 0) else credit_rate

    if paid_currency == "USD":
        amount_usd_paid = round(inp.amount, 2)
        # Convert to TRY using the DEBT's locked rate so USD-denominated debt is respected
        amount_try_paid = round(amount_usd_paid * credit_rate, 2)
    else:
        amount_try_paid = round(inp.amount, 2)
        # For USD side, use payment-time rate (informational)
        amount_usd_paid = round(amount_try_paid / payment_rate, 2) if payment_rate > 0 else 0.0

    new_paid = round(prev_paid + amount_try_paid, 2)
    if new_paid > debt + 0.01:
        raise HTTPException(400, f"Ödeme miktarı kalan borçtan fazla olamaz. Kalan borç: {round(debt - prev_paid, 2)} ₺")

    payment = {
        "amount": amount_try_paid,  # keeps TRY as the primary
        "amount_usd": amount_usd_paid,
        "exchange_rate": payment_rate,
        "paid_currency": paid_currency,
        "date": inp.date or datetime.now(timezone.utc).date().isoformat(),
        "paid_at": datetime.now(timezone.utc).isoformat(),
        "paid_by_email": user["email"],
        "note": inp.note or None,
    }

    # Partner kasa splits (manual distribution). Default: full amount → Playspintech.
    splits = inp.splits or [{"kasa": "Playspintech", "amount": amount_try_paid}]
    total_split = round(sum(float(s.get("amount", 0)) for s in splits), 2)
    if abs(total_split - amount_try_paid) > 0.01:
        raise HTTPException(400, f"Dağılım toplamı ödeme tutarına eşit olmalı ({total_split} ≠ {amount_try_paid})")
    for s in splits:
        if s.get("kasa") not in PARTNER_KASAS:
            raise HTTPException(400, f"Geçersiz kasa: {s.get('kasa')}. Geçerli: {PARTNER_KASAS}")
        if float(s.get("amount", 0)) < 0:
            raise HTTPException(400, "Dağılım tutarları negatif olamaz")
    payment["splits"] = [{"kasa": s["kasa"], "amount": round(float(s["amount"]), 2)} for s in splits if float(s.get("amount", 0)) > 0]

    new_status = "paid" if new_paid >= debt - 0.01 else "partial"
    prev_paid_usd = float(existing.get("paid_amount_usd", 0) or 0)
    new_paid_usd = round(prev_paid_usd + amount_usd_paid, 2)
    updates: dict = {
        "paid_amount": new_paid,
        "paid_amount_usd": new_paid_usd,
        "status": new_status,
    }
    if new_status == "paid":
        updates["paid_at"] = payment["paid_at"]
        updates["paid_by_email"] = user["email"]
    await db.site_credits.update_one({"id": cid}, {"$set": updates, "$push": {"payments": payment}})

    # Write partner kasa movements
    for s in payment["splits"]:
        mv = PartnerKasaMovement(
            kasa=s["kasa"],
            type="credit_payment",
            amount=s["amount"],
            site_credit_id=cid,
            site_id=existing["site_id"],
            payment_ref=payment["paid_at"],
            note=inp.note,
            date=payment["date"],
            created_by_email=user["email"],
        )
        await db.partner_kasa_movements.insert_one(mv.model_dump())

    await log_audit(user, "site_credit.payment", "site_credit", cid,
                    site_id=existing["site_id"],
                    details={"amount": inp.amount, "date": payment["date"], "status": new_status, "paid_total": new_paid, "splits": payment["splits"]})

    doc = await db.site_credits.find_one({"id": cid}, {"_id": 0})
    site = await db.sites.find_one({"id": doc["site_id"]}, {"_id": 0})
    doc["site_name"] = site.get("name") if site else "?"
    # Fire-and-forget Telegram notifications (site + admin-global)
    await _telegram_send_safe(site, _fmt_credit_payment_message(doc["site_name"], doc, payment["amount"], payment["date"]))
    splits_txt = ", ".join([f"{s['kasa']} ₺{_amt(float(s['amount']))}" for s in payment["splits"]]) if payment.get("splits") else "—"
    cur_label = "USD" if paid_currency == "USD" else "TRY"
    orig_amt_display = f"${_amt(amount_usd_paid)}" if paid_currency == "USD" else f"₺{_amt(amount_try_paid)}"
    admin_msg = (
        "*Playspintech — Kredi Ödemesi Alındı*\n"
        f"_Site:_ *{doc['site_name']}*\n"
        f"_Ödeme:_ {orig_amt_display} _({cur_label})_ · _Tarih:_ `{payment['date']}`\n"
        f"_TL Karşılığı:_ ₺{_amt(amount_try_paid)} · _USD Karşılığı:_ ${_amt(amount_usd_paid)}\n"
        f"_Kalan Borç:_ ₺{_amt(float(doc.get('debt', 0)) - float(doc.get('paid_amount', 0)))} · _Durum:_ `{new_status}`\n"
        f"_Dağıtım:_ {splits_txt}"
    )
    await _admin_notify("site_credit_paid", admin_msg)
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


@api_router.get("/admin/partner-kasalar")
async def list_partner_kasalar(user: dict = Depends(require_admin)):
    """Return the 4 partner kasas with computed balance + counters."""
    result = []
    for name in PARTNER_KASAS:
        # aggregate balance
        cursor = db.partner_kasa_movements.find({"kasa": name}, {"_id": 0, "amount": 1, "type": 1})
        balance = 0.0
        deposits = 0.0
        withdrawals = 0.0
        count = 0
        async for m in cursor:
            amt = float(m.get("amount") or 0)
            balance += amt
            if amt >= 0:
                deposits += amt
            else:
                withdrawals += abs(amt)
            count += 1
        result.append({
            "name": name,
            "balance": round(balance, 2),
            "total_deposits": round(deposits, 2),
            "total_withdrawals": round(withdrawals, 2),
            "movement_count": count,
        })
    return result


@api_router.get("/admin/partner-kasalar/{kasa}/movements")
async def list_partner_kasa_movements(kasa: str, limit: int = 200, user: dict = Depends(require_admin)):
    if kasa not in PARTNER_KASAS:
        raise HTTPException(404, "Kasa bulunamadı")
    docs = await db.partner_kasa_movements.find({"kasa": kasa}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    # attach site names for context
    site_ids = [d.get("site_id") for d in docs if d.get("site_id")]
    if site_ids:
        sites = await db.sites.find({"id": {"$in": site_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
        smap = {s["id"]: s["name"] for s in sites}
        for d in docs:
            d["site_name"] = smap.get(d.get("site_id"))
    return docs


@api_router.post("/admin/partner-kasalar/{kasa}/withdraw")
async def withdraw_partner_kasa(kasa: str, inp: PartnerWithdrawInput, user: dict = Depends(require_admin)):
    if kasa not in PARTNER_KASAS:
        raise HTTPException(404, "Kasa bulunamadı")
    if inp.amount <= 0:
        raise HTTPException(400, "Çekim tutarı 0'dan büyük olmalı")
    # check balance
    cursor = db.partner_kasa_movements.find({"kasa": kasa}, {"_id": 0, "amount": 1})
    balance = 0.0
    async for m in cursor:
        balance += float(m.get("amount") or 0)
    if inp.amount > balance + 0.01:
        raise HTTPException(400, f"Yetersiz bakiye. Mevcut: {round(balance, 2)} ₺")
    mv = PartnerKasaMovement(
        kasa=kasa,
        type="withdrawal",
        amount=-round(inp.amount, 2),
        note=inp.note,
        date=inp.date or datetime.now(timezone.utc).date().isoformat(),
        created_by_email=user["email"],
    )
    await db.partner_kasa_movements.insert_one(mv.model_dump())
    await log_audit(user, "partner_kasa.withdraw", "partner_kasa", kasa,
                    details={"amount": inp.amount, "date": mv.date})
    await _admin_notify(
        "partner_movement",
        f"*Ortak Kasa — Çekim*\n"
        f"_Kasa:_ *{kasa}*\n"
        f"_Tutar:_ −₺{_amt(float(inp.amount))}\n"
        f"_Yeni Bakiye:_ ₺{_amt(balance - inp.amount)}"
        + (f"\n_Not:_ {inp.note}" if inp.note else "")
    )
    return {**mv.model_dump(), "new_balance": round(balance - inp.amount, 2)}


@api_router.get("/admin/site-credits-summary")
async def site_credits_summary(user: dict = Depends(require_admin)):
    """Per-site aggregated credit/debt overview for the new Site Kredileri sayfası."""
    # sites
    sites = await db.sites.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
    smap = {s["id"]: s["name"] for s in sites}
    # aggregate credits per site (exclude archived)
    docs = await db.site_credits.find({"archived": {"$ne": True}}, {"_id": 0}).to_list(5000)
    per_site: dict = {}
    for c in docs:
        sid = c.get("site_id")
        agg = per_site.setdefault(sid, {
            "site_id": sid, "site_name": smap.get(sid, "?"),
            "total_credit": 0.0, "total_debt": 0.0, "total_paid": 0.0,
            "total_remaining": 0.0, "unpaid_count": 0, "paid_count": 0, "partial_count": 0,
            "credit_count": 0,
            "total_credit_usd": 0.0, "total_debt_usd": 0.0, "total_paid_usd": 0.0, "total_remaining_usd": 0.0,
        })
        debt = float(c.get("debt", 0))
        paid = float(c.get("paid_amount") or (debt if c.get("status") == "paid" else 0))
        agg["total_credit"] += float(c.get("amount", 0))
        agg["total_debt"] += debt
        agg["total_paid"] += paid
        agg["total_remaining"] += max(0.0, debt - paid)
        agg["credit_count"] += 1
        # USD carry-over (only for credits that have exchange_rate stored)
        debt_usd = float(c.get("debt_usd") or 0)
        amount_usd = float(c.get("amount_usd") or 0)
        paid_usd = float(c.get("paid_amount_usd") or 0)
        agg["total_credit_usd"] += amount_usd
        agg["total_debt_usd"] += debt_usd
        agg["total_paid_usd"] += paid_usd
        agg["total_remaining_usd"] += max(0.0, debt_usd - paid_usd)
        if c.get("status") == "paid":
            agg["paid_count"] += 1
        elif c.get("status") == "partial":
            agg["partial_count"] += 1
        else:
            agg["unpaid_count"] += 1
    for row in per_site.values():
        for k in ("total_credit", "total_debt", "total_paid", "total_remaining",
                  "total_credit_usd", "total_debt_usd", "total_paid_usd", "total_remaining_usd"):
            row[k] = round(row[k], 2)
    return sorted(per_site.values(), key=lambda r: r["total_remaining"], reverse=True)


async def _partner_kasa_backfill_once():
    """Backfill: create Playspintech movements for all existing payments that have no split yet."""
    meta = await db.system_meta.find_one({"key": "partner_kasa_backfill_v1"})
    if meta:
        return
    count = 0
    async for c in db.site_credits.find({"payments.0": {"$exists": True}}, {"_id": 0}):
        for p in c.get("payments", []):
            if p.get("splits"):
                continue
            amt = float(p.get("amount", 0))
            if amt <= 0:
                continue
            mv = {
                "id": uid(), "kasa": "Playspintech", "type": "backfill", "amount": round(amt, 2),
                "site_credit_id": c["id"], "site_id": c.get("site_id"),
                "payment_ref": p.get("paid_at"), "note": "Retroaktif Playspintech kasasına aktarım",
                "date": p.get("date") or datetime.now(timezone.utc).date().isoformat(),
                "created_by_email": "system",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.partner_kasa_movements.insert_one(mv)
            count += 1
    await db.system_meta.insert_one({
        "key": "partner_kasa_backfill_v1",
        "at": datetime.now(timezone.utc).isoformat(),
        "moved_count": count,
    })
    logging.info(f"[backfill] Partner kasa: {count} historical payments migrated to Playspintech")


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


# ============== ADMIN: PAYMENTS (Admin's own expense ledger) ==============

def _admin_telegram_config_from_db(doc: Optional[dict]) -> dict:
    doc = doc or {}
    return {
        "telegram_bot_token": doc.get("telegram_bot_token") or "",
        "telegram_chat_id": doc.get("telegram_chat_id") or "",
        "configured": bool(doc.get("telegram_bot_token") and doc.get("telegram_chat_id")),
    }


async def _admin_telegram_send_safe(text: str) -> dict:
    """Send a markdown message to the global admin Telegram group. Silent-fail with status dict.
    Returns {'ok': bool, 'error': str|None}."""
    cfg = await db.admin_settings.find_one({"id": "global"}, {"_id": 0})
    if not cfg or not cfg.get("telegram_bot_token") or not cfg.get("telegram_chat_id"):
        return {"ok": False, "error": "not_configured"}
    try:
        import httpx
        async with httpx.AsyncClient(timeout=15.0) as tg_client:
            resp = await tg_client.post(
                f"https://api.telegram.org/bot{cfg['telegram_bot_token']}/sendMessage",
                json={
                    "chat_id": cfg["telegram_chat_id"],
                    "text": text,
                    "parse_mode": "Markdown",
                    "disable_web_page_preview": True,
                },
            )
            if resp.status_code != 200:
                body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {"text": resp.text}
                return {"ok": False, "error": body.get("description") or "telegram_api_error"}
            return {"ok": True, "error": None}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def _admin_notify(event_type: str, text: str) -> dict:
    """Higher-level helper: check notification prefs, send Telegram, log to admin_notification_logs.
    event_type must be one of DEFAULT_NOTIFICATION_PREFS keys. Silent-fail — never raises."""
    try:
        cfg = await db.admin_settings.find_one({"id": "global"}, {"_id": 0})
        prefs = (cfg or {}).get("notification_prefs") or DEFAULT_NOTIFICATION_PREFS
        # Missing key falls back to default True (opt-in by default for new event types)
        enabled = prefs.get(event_type, DEFAULT_NOTIFICATION_PREFS.get(event_type, True))
        if not enabled:
            await db.admin_notification_logs.insert_one({
                "id": uid(),
                "event_type": event_type,
                "status": "skipped_disabled",
                "text_preview": text[:200],
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            return {"ok": False, "error": "disabled"}
        result = await _admin_telegram_send_safe(text)
        await db.admin_notification_logs.insert_one({
            "id": uid(),
            "event_type": event_type,
            "status": "sent" if result.get("ok") else f"failed:{result.get('error')}",
            "text_preview": text[:200],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        # Cap log to last 500 entries
        count = await db.admin_notification_logs.count_documents({})
        if count > 500:
            excess = count - 500
            oldest = await db.admin_notification_logs.find({}, {"_id": 0, "id": 1}).sort([("created_at", 1)]).limit(excess).to_list(excess)
            if oldest:
                await db.admin_notification_logs.delete_many({"id": {"$in": [x["id"] for x in oldest]}})
        return result
    except Exception as e:
        logging.warning(f"[_admin_notify] {event_type} failed: {e}")
        return {"ok": False, "error": str(e)}


def _amt(n: float) -> str:
    """Turkish TRY number formatting without currency symbol. 1234.5 → '1.234,50'"""
    try:
        s = f"{float(n):,.2f}"
        return s.replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return str(n)


DEFAULT_USD_RATE = 30.0

# Free public FX APIs (no key). Tried in order until one succeeds.
USD_RATE_SOURCES = [
    # (name, url, extractor(json) -> float)
    ("frankfurter", "https://api.frankfurter.app/latest?from=USD&to=TRY",
     lambda j: float((j.get("rates") or {}).get("TRY"))),
    ("open.er-api", "https://open.er-api.com/v6/latest/USD",
     lambda j: float((j.get("rates") or {}).get("TRY"))),
]


async def _get_current_usd_rate() -> float:
    """Return the global USD/TRY exchange rate from admin_settings. Falls back to DEFAULT_USD_RATE."""
    doc = await db.admin_settings.find_one({"id": "global"}, {"_id": 0, "usd_rate": 1})
    r = (doc or {}).get("usd_rate")
    try:
        r = float(r) if r is not None else DEFAULT_USD_RATE
        return r if r > 0 else DEFAULT_USD_RATE
    except Exception:
        return DEFAULT_USD_RATE


async def _fetch_live_usd_rate() -> dict:
    """Fetch live USD/TRY rate from public APIs. Returns dict {ok, rate, source, error}."""
    import httpx
    last_err = None
    for name, url, extractor in USD_RATE_SOURCES:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(url)
                r.raise_for_status()
                rate = extractor(r.json())
                if rate and rate > 0:
                    return {"ok": True, "rate": float(rate), "source": name, "error": None}
                last_err = f"{name}: invalid rate"
        except Exception as e:
            last_err = f"{name}: {e}"
            continue
    return {"ok": False, "rate": None, "source": None, "error": last_err or "no sources"}


async def _refresh_usd_rate_if_auto(force: bool = False) -> dict:
    """Fetch live rate and persist only if auto mode is enabled (or force=True).
    Returns the current admin_settings usd_rate doc snapshot."""
    doc = await db.admin_settings.find_one({"id": "global"}, {"_id": 0}) or {}
    # Default to auto if never set
    mode = doc.get("usd_rate_mode") or "auto"
    if mode != "auto" and not force:
        return {"skipped": True, "reason": "manual_mode"}
    fetched = await _fetch_live_usd_rate()
    now = datetime.now(timezone.utc).isoformat()
    if fetched["ok"]:
        await db.admin_settings.update_one(
            {"id": "global"},
            {"$set": {
                "usd_rate": fetched["rate"],
                "usd_rate_updated_at": now,
                "usd_rate_last_fetch_at": now,
                "usd_rate_source": fetched["source"],
                "usd_rate_fetch_error": None,
             },
             "$setOnInsert": {"id": "global", "created_at": now, "usd_rate_mode": "auto"}},
            upsert=True,
        )
        logging.info(f"[usd_rate] Auto-fetched {fetched['rate']} from {fetched['source']}")
        return {"ok": True, "rate": fetched["rate"], "source": fetched["source"], "updated_at": now}
    else:
        await db.admin_settings.update_one(
            {"id": "global"},
            {"$set": {
                "usd_rate_last_fetch_at": now,
                "usd_rate_fetch_error": fetched["error"],
             },
             "$setOnInsert": {"id": "global", "created_at": now, "usd_rate_mode": "auto"}},
            upsert=True,
        )
        logging.warning(f"[usd_rate] Fetch failed: {fetched['error']}")
        return {"ok": False, "error": fetched["error"]}


async def _usd_rate_fetch_loop():
    """Background task: hourly refresh of USD/TRY rate when auto mode enabled."""
    # Initial fetch shortly after startup so first login sees fresh data
    await asyncio.sleep(10)
    while True:
        try:
            await _refresh_usd_rate_if_auto()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logging.error(f"[usd_rate] Loop error: {e}")
        try:
            await asyncio.sleep(3600)  # 1 hour
        except asyncio.CancelledError:
            raise


async def _partner_kasa_balance(kasa: str) -> float:
    """Sum of all partner_kasa_movements amount for a given kasa."""
    balance = 0.0
    async for m in db.partner_kasa_movements.find({"kasa": kasa}, {"_id": 0, "amount": 1}):
        balance += float(m.get("amount") or 0)
    return round(balance, 2)


def _fmt_admin_payments_message(date_from: str, date_to: str, rows: List[dict], total: float) -> str:
    def _fmt_try(n: float) -> str:
        return f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    lines = [
        "*Playspintech Admin — Ödemeler*",
        f"_Dönem:_ `{date_from}` → `{date_to}`",
        "",
    ]
    if not rows:
        lines.append("_Bu dönemde ödeme kaydı yok._")
    else:
        for r in rows[:50]:  # cap to avoid Telegram limit
            cat = f" · _{r['category']}_" if r.get("category") else ""
            partner = f" · _{r['partner_name']}_" if r.get("partner_name") else ""
            lines.append(f"• `{r['date']}` — {r['description']}{cat}{partner}  →  *₺{_fmt_try(float(r['amount']))}*")
        if len(rows) > 50:
            lines.append(f"_… ve {len(rows) - 50} kayıt daha_")
    lines.append("")
    lines.append(f"*Toplam:* ₺{_fmt_try(total)}")
    lines.append(f"*Kayıt sayısı:* {len(rows)}")
    return "\n".join(lines)


@api_router.get("/admin/payments")
async def list_admin_payments(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user: dict = Depends(require_admin),
):
    q: dict = {}
    if date_from and date_to:
        q["date"] = {"$gte": date_from, "$lte": date_to}
    elif date_from:
        q["date"] = {"$gte": date_from}
    elif date_to:
        q["date"] = {"$lte": date_to}
    docs = await db.admin_payments.find(q, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).to_list(2000)
    total = round(sum(float(d.get("amount", 0)) for d in docs), 2)
    return {"items": docs, "total": total, "count": len(docs)}


@api_router.post("/admin/payments")
async def create_admin_payment(inp: AdminPaymentInput, user: dict = Depends(require_admin)):
    if not inp.description.strip():
        raise HTTPException(400, "Açıklama gerekli")
    if inp.amount is None or inp.amount <= 0:
        raise HTTPException(400, "Tutar 0'dan büyük olmalı")
    if inp.partner_name not in PARTNER_KASAS:
        raise HTTPException(400, f"Geçersiz ortak kasa. Geçerli: {PARTNER_KASAS}")
    pid = uid()
    rate = float(inp.exchange_rate) if (inp.exchange_rate and inp.exchange_rate > 0) else await _get_current_usd_rate()
    amount_usd = round(float(inp.amount) / rate, 2) if rate > 0 else 0.0
    doc = {
        "id": pid,
        "date": inp.date,
        "description": inp.description.strip(),
        "amount": float(inp.amount),
        "amount_usd": amount_usd,
        "exchange_rate": rate,
        "partner_name": inp.partner_name,
        "category": (inp.category or "").strip() or None,
        "note": (inp.note or "").strip() or None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by_email": user.get("email"),
    }
    await db.admin_payments.insert_one(doc)
    # Deduct from the selected partner kasa (movement type=admin_payment, negative amount)
    mv = PartnerKasaMovement(
        kasa=inp.partner_name,
        type="admin_payment",
        amount=-round(float(inp.amount), 2),
        note=doc["description"] + (f" [{doc['category']}]" if doc["category"] else ""),
        date=inp.date,
        created_by_email=user["email"],
    )
    mv_dict = mv.model_dump()
    mv_dict["admin_payment_id"] = pid  # link for reversal on delete/update
    await db.partner_kasa_movements.insert_one(mv_dict)
    await log_audit(user, "admin_payment.create", "admin_payment", pid,
                    details={"amount": doc["amount"], "description": doc["description"], "partner_name": doc["partner_name"]})
    await _admin_notify(
        "admin_payment_created",
        f"*Playspintech — Yeni Ödeme*\n"
        f"_Açıklama:_ {doc['description']}\n"
        f"_Tutar:_ ₺{_amt(float(doc['amount']))}\n"
        f"_Ortak Kasa:_ *{doc['partner_name']}* (kasadan düşüldü)\n"
        f"_Tarih:_ `{doc['date']}`"
        + (f"\n_Kategori:_ _{doc['category']}_" if doc.get("category") else "")
    )
    return {k: v for k, v in doc.items() if k != "_id"}


@api_router.get("/admin/payments/export.csv")
async def export_admin_payments_csv(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user: dict = Depends(require_admin),
):
    q: dict = {}
    if date_from and date_to:
        q["date"] = {"$gte": date_from, "$lte": date_to}
    elif date_from:
        q["date"] = {"$gte": date_from}
    elif date_to:
        q["date"] = {"$lte": date_to}
    docs = await db.admin_payments.find(q, {"_id": 0}).sort([("date", 1), ("created_at", 1)]).to_list(5000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Tarih", "Açıklama", "Ortak Kasa", "Kategori", "Tutar (TRY)", "Not", "Oluşturan"])
    total = 0.0
    for d in docs:
        amt = float(d.get("amount", 0))
        total += amt
        writer.writerow([
            d.get("date", ""),
            d.get("description", ""),
            d.get("partner_name") or "",
            d.get("category") or "",
            f"{amt:.2f}",
            d.get("note") or "",
            d.get("created_by_email") or "",
        ])
    writer.writerow([])
    writer.writerow(["TOPLAM", "", "", f"{total:.2f}", "", ""])
    fname_from = date_from or "hepsi"
    fname_to = date_to or "hepsi"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="admin_odemeler_{fname_from}_{fname_to}.csv"'},
    )


@api_router.get("/admin/payments/telegram-config")
async def get_admin_payments_telegram_config(user: dict = Depends(require_admin)):
    doc = await db.admin_settings.find_one({"id": "global"}, {"_id": 0})
    return _admin_telegram_config_from_db(doc)


@api_router.put("/admin/payments/telegram-config")
async def set_admin_payments_telegram_config(inp: TelegramConfigInput, user: dict = Depends(require_admin)):
    update = {
        "telegram_bot_token": (inp.telegram_bot_token or "").strip() or None,
        "telegram_chat_id": (inp.telegram_chat_id or "").strip() or None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.admin_settings.update_one(
        {"id": "global"},
        {"$set": update, "$setOnInsert": {"id": "global", "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    await log_audit(user, "admin_payments.telegram_config", "admin_settings", "global",
                    details={"configured": bool(update["telegram_bot_token"] and update["telegram_chat_id"])})
    doc = await db.admin_settings.find_one({"id": "global"}, {"_id": 0})
    return _admin_telegram_config_from_db(doc)


@api_router.get("/admin/payments/telegram-preview")
async def preview_admin_payments_telegram(
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
    result = await list_admin_payments(date_from, date_to, user)
    msg = _fmt_admin_payments_message(date_from, date_to, result["items"], result["total"])
    cfg = await db.admin_settings.find_one({"id": "global"}, {"_id": 0})
    return {"message": msg, "configured": bool((cfg or {}).get("telegram_bot_token") and (cfg or {}).get("telegram_chat_id"))}


@api_router.post("/admin/payments/send-telegram")
async def send_admin_payments_telegram(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user: dict = Depends(require_admin),
):
    cfg = await db.admin_settings.find_one({"id": "global"}, {"_id": 0})
    if not cfg or not cfg.get("telegram_bot_token") or not cfg.get("telegram_chat_id"):
        raise HTTPException(400, "Admin Telegram yapılandırması tanımlı değil. Bu sayfadaki Telegram Ayarları bölümünden bot token ve chat ID ekleyin.")
    today = date.today()
    if not date_from:
        date_from = today.replace(day=1).isoformat()
    if not date_to:
        _, last = monthrange(today.year, today.month)
        date_to = today.replace(day=last).isoformat()
    result = await list_admin_payments(date_from, date_to, user)
    msg = _fmt_admin_payments_message(date_from, date_to, result["items"], result["total"])

    import httpx
    url = f"https://api.telegram.org/bot{cfg['telegram_bot_token']}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=15.0) as tg_client:
            resp = await tg_client.post(url, json={
                "chat_id": cfg["telegram_chat_id"],
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

    await log_audit(user, "admin_payments.telegram_send", "admin_payments", "range",
                    details={"date_from": date_from, "date_to": date_to, "count": result["count"], "total": result["total"]})
    return {"ok": True, "count": result["count"], "total": result["total"]}


@api_router.put("/admin/payments/{pid}")
async def update_admin_payment(pid: str, inp: AdminPaymentInput, user: dict = Depends(require_admin)):
    existing = await db.admin_payments.find_one({"id": pid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Ödeme bulunamadı")
    if not inp.description.strip():
        raise HTTPException(400, "Açıklama gerekli")
    if inp.amount is None or inp.amount <= 0:
        raise HTTPException(400, "Tutar 0'dan büyük olmalı")
    if inp.partner_name not in PARTNER_KASAS:
        raise HTTPException(400, f"Geçersiz ortak kasa. Geçerli: {PARTNER_KASAS}")
    update = {
        "date": inp.date,
        "description": inp.description.strip(),
        "amount": float(inp.amount),
        "partner_name": inp.partner_name,
        "category": (inp.category or "").strip() or None,
        "note": (inp.note or "").strip() or None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.admin_payments.update_one({"id": pid}, {"$set": update})
    # Reverse+recreate the partner_kasa movement
    await db.partner_kasa_movements.delete_many({"admin_payment_id": pid})
    mv = PartnerKasaMovement(
        kasa=inp.partner_name,
        type="admin_payment",
        amount=-round(float(inp.amount), 2),
        note=update["description"] + (f" [{update['category']}]" if update["category"] else ""),
        date=inp.date,
        created_by_email=user["email"],
    )
    mv_dict = mv.model_dump()
    mv_dict["admin_payment_id"] = pid
    await db.partner_kasa_movements.insert_one(mv_dict)
    await log_audit(user, "admin_payment.update", "admin_payment", pid,
                    details={"amount": update["amount"], "description": update["description"], "partner_name": update["partner_name"]})
    return await db.admin_payments.find_one({"id": pid}, {"_id": 0})


@api_router.delete("/admin/payments/{pid}")
async def delete_admin_payment(pid: str, user: dict = Depends(require_admin)):
    existing = await db.admin_payments.find_one({"id": pid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Ödeme bulunamadı")
    await db.admin_payments.delete_one({"id": pid})
    # Also drop the partner_kasa movement so the vault is restored
    await db.partner_kasa_movements.delete_many({"admin_payment_id": pid})
    await log_audit(user, "admin_payment.delete", "admin_payment", pid,
                    details={"amount": existing.get("amount"), "description": existing.get("description")})
    return {"ok": True}


@api_router.get("/admin/settings/usd-rate")
async def get_admin_usd_rate(user: dict = Depends(require_admin)):
    rate = await _get_current_usd_rate()
    doc = await db.admin_settings.find_one({"id": "global"}, {"_id": 0}) or {}
    return {
        "usd_rate": rate,
        "updated_at": doc.get("usd_rate_updated_at"),
        "mode": doc.get("usd_rate_mode") or "auto",
        "source": doc.get("usd_rate_source"),
        "last_fetch_at": doc.get("usd_rate_last_fetch_at"),
        "fetch_error": doc.get("usd_rate_fetch_error"),
    }


class UsdRateInput(BaseModel):
    usd_rate: Optional[float] = None
    mode: Optional[Literal["auto", "manual"]] = None


@api_router.put("/admin/settings/usd-rate")
async def set_admin_usd_rate(inp: UsdRateInput, user: dict = Depends(require_admin)):
    now = datetime.now(timezone.utc).isoformat()
    update: dict = {}
    audit_details: dict = {}

    if inp.mode is not None:
        update["usd_rate_mode"] = inp.mode
        audit_details["mode"] = inp.mode

    if inp.usd_rate is not None:
        if inp.usd_rate <= 0:
            raise HTTPException(400, "Kur 0'dan büyük olmalı")
        update["usd_rate"] = float(inp.usd_rate)
        update["usd_rate_updated_at"] = now
        update["usd_rate_source"] = "manual"
        # Setting a value implies manual override unless mode explicitly set to auto
        if inp.mode is None:
            update["usd_rate_mode"] = "manual"
        audit_details["usd_rate"] = float(inp.usd_rate)

    if not update:
        raise HTTPException(400, "Değişiklik yok")

    await db.admin_settings.update_one(
        {"id": "global"},
        {"$set": update, "$setOnInsert": {"id": "global", "created_at": now}},
        upsert=True,
    )
    await log_audit(user, "admin.usd_rate", "admin_settings", "global", details=audit_details)

    # If user just switched to auto, immediately fetch a fresh rate
    if update.get("usd_rate_mode") == "auto" and inp.usd_rate is None:
        await _refresh_usd_rate_if_auto(force=True)

    return await get_admin_usd_rate(user)


@api_router.post("/admin/settings/usd-rate/refresh")
async def refresh_admin_usd_rate(user: dict = Depends(require_admin)):
    """Force-fetch the live USD/TRY rate now (regardless of mode)."""
    result = await _refresh_usd_rate_if_auto(force=True)
    await log_audit(user, "admin.usd_rate.refresh", "admin_settings", "global", details=result)
    if not result.get("ok"):
        raise HTTPException(502, f"Kur çekilemedi: {result.get('error') or 'bilinmeyen hata'}")
    return await get_admin_usd_rate(user)


@api_router.get("/settings/usd-rate/public")
async def get_public_usd_rate(user: dict = Depends(get_current_user)):
    """Lightweight endpoint any authenticated user can call (used by topbar widget)."""
    rate = await _get_current_usd_rate()
    doc = await db.admin_settings.find_one({"id": "global"}, {"_id": 0, "usd_rate_updated_at": 1, "usd_rate_source": 1}) or {}
    return {
        "usd_rate": rate,
        "updated_at": doc.get("usd_rate_updated_at"),
        "source": doc.get("usd_rate_source"),
    }


# ============== ADMIN: NOTIFICATIONS (Central Bot Settings) ==============

@api_router.get("/admin/notifications/config")
async def get_admin_notification_config(user: dict = Depends(require_admin)):
    """Return admin bot config + notification preferences."""
    doc = await db.admin_settings.find_one({"id": "global"}, {"_id": 0}) or {}
    prefs = doc.get("notification_prefs") or {}
    # Merge with defaults so missing keys are surfaced as True
    merged = {**DEFAULT_NOTIFICATION_PREFS, **{k: bool(v) for k, v in prefs.items() if k in DEFAULT_NOTIFICATION_PREFS}}
    return {
        "telegram_bot_token": doc.get("telegram_bot_token") or "",
        "telegram_chat_id": doc.get("telegram_chat_id") or "",
        "configured": bool(doc.get("telegram_bot_token") and doc.get("telegram_chat_id")),
        "notification_prefs": merged,
    }


@api_router.put("/admin/notifications/config")
async def set_admin_notification_config(inp: AdminNotificationConfigInput, user: dict = Depends(require_admin)):
    update: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if inp.telegram_bot_token is not None:
        update["telegram_bot_token"] = inp.telegram_bot_token.strip() or None
    if inp.telegram_chat_id is not None:
        update["telegram_chat_id"] = inp.telegram_chat_id.strip() or None
    if inp.notification_prefs is not None:
        # Only keep known keys
        clean = {k: bool(v) for k, v in inp.notification_prefs.items() if k in DEFAULT_NOTIFICATION_PREFS}
        update["notification_prefs"] = {**DEFAULT_NOTIFICATION_PREFS, **clean}
    await db.admin_settings.update_one(
        {"id": "global"},
        {"$set": update, "$setOnInsert": {"id": "global", "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    await log_audit(user, "admin.notifications_config", "admin_settings", "global",
                    details={k: (bool(v) if k != "notification_prefs" else v) for k, v in update.items() if k != "updated_at"})
    return await get_admin_notification_config(user)


@api_router.post("/admin/notifications/test")
async def test_admin_notification(user: dict = Depends(require_admin)):
    """Send a test message to verify the bot config."""
    msg = (
        "*Playspintech — Bot Test*\n"
        f"_Gönderen:_ `{user.get('email')}`\n"
        f"_Zaman:_ `{datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')}`\n"
        "Bot yapılandırması çalışıyor ✅"
    )
    result = await _admin_telegram_send_safe(msg)
    await db.admin_notification_logs.insert_one({
        "id": uid(),
        "event_type": "test",
        "status": "sent" if result.get("ok") else f"failed:{result.get('error')}",
        "text_preview": msg[:200],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return result


@api_router.get("/admin/notifications/logs")
async def list_admin_notification_logs(limit: int = 50, user: dict = Depends(require_admin)):
    logs = await db.admin_notification_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 200))
    return {"items": logs, "count": len(logs)}


@api_router.post("/admin/notifications/send-partner-summary")
async def send_partner_summary_telegram(user: dict = Depends(require_admin)):
    """Manual: send an instant summary of all 4 partner vault balances."""
    lines = ["*Ortak Kasa Bakiye Özeti*", ""]
    total = 0.0
    for kasa in PARTNER_KASAS:
        bal = 0.0
        async for m in db.partner_kasa_movements.find({"kasa": kasa}, {"_id": 0, "amount": 1}):
            bal += float(m.get("amount") or 0)
        total += bal
        emoji = "🟢" if bal >= 0 else "🔴"
        lines.append(f"{emoji} *{kasa}:* ₺{_amt(round(bal, 2))}")
    lines.append("")
    lines.append(f"_Toplam:_ *₺{_amt(round(total, 2))}*")
    lines.append(f"_Zaman:_ `{datetime.now(timezone.utc).date().isoformat()}`")
    msg = "\n".join(lines)
    result = await _admin_notify("partner_movement", msg)  # reuse partner_movement pref
    return {**result, "message": msg}


@api_router.post("/admin/notifications/send-site-credits-summary")
async def send_site_credits_summary_telegram(user: dict = Depends(require_admin)):
    """Manual: send Site Credits (borç/ödeme) summary."""
    summary = await site_credits_summary(user)
    lines = ["*Site Kredileri Özet*", ""]
    grand_credit = grand_debt = grand_paid = grand_rem = 0.0
    for row in summary[:30]:  # cap
        lines.append(
            f"• *{row['site_name']}*  →  Verilen ₺{_amt(row['total_credit'])} · "
            f"Borç ₺{_amt(row['total_debt'])} · Ödenen ₺{_amt(row['total_paid'])} · "
            f"*Kalan ₺{_amt(row['total_remaining'])}*"
        )
        grand_credit += row["total_credit"]
        grand_debt += row["total_debt"]
        grand_paid += row["total_paid"]
        grand_rem += row["total_remaining"]
    if len(summary) > 30:
        lines.append(f"_… ve {len(summary) - 30} site daha_")
    lines.append("")
    lines.append(
        f"*Toplam:* Verilen ₺{_amt(round(grand_credit, 2))} · Borç ₺{_amt(round(grand_debt, 2))} · "
        f"Ödenen ₺{_amt(round(grand_paid, 2))} · *Kalan ₺{_amt(round(grand_rem, 2))}*"
    )
    msg = "\n".join(lines)
    result = await _admin_notify("site_credit_paid", msg)  # reuse pref
    return {**result, "message": msg}


async def _admin_daily_digest():
    """Compose and send a daily digest to the admin group. Uses admin_report for today's data."""
    today = date.today()
    date_from = today.isoformat()
    date_to = today.isoformat()
    # Fake user dict to satisfy admin_report signature (audit not needed for internal call)
    dummy = {"email": "system", "platform_role": "admin"}
    try:
        report = await admin_report(date_from, date_to, None, dummy)
    except Exception as e:
        logging.warning(f"[daily_digest] Report failed: {e}")
        return {"ok": False, "error": "report_failed"}
    totals = report.get("totals", {})
    lines = [
        "*Playspintech — Günlük Özet*",
        f"_Tarih:_ `{today.isoformat()}`",
        "",
        f"💰 *Gelir:* ₺{_amt(totals.get('income', 0.0))}",
        f"💸 *Gider:* ₺{_amt(totals.get('expense', 0.0))}",
        f"📊 *Net:* ₺{_amt(totals.get('net', 0.0))}",
    ]
    # Include per-partner income if any
    inc_lines = [f"  {r['partner_name']}: ₺{_amt(r['amount'])}"
                 for r in report.get("income_by_partner", []) if r.get("amount")]
    if inc_lines:
        lines.append("")
        lines.append("_Ortak Kasalara Giren:_")
        lines.extend(inc_lines)
    return await _admin_notify("daily_digest", "\n".join(lines))


async def _admin_daily_digest_loop():
    """Background task: send daily digest at 10:00 Europe/Istanbul (07:00 UTC)."""
    while True:
        try:
            now = datetime.now(timezone.utc)
            target = now.replace(hour=7, minute=0, second=0, microsecond=0)
            if target <= now:
                target = target + timedelta(days=1)
            sleep_sec = (target - now).total_seconds()
            logging.info(f"[digest] Next daily digest in {int(sleep_sec / 60)} min at {target.isoformat()}")
            await asyncio.sleep(sleep_sec)
            result = await _admin_daily_digest()
            logging.info(f"[digest] Result: {result}")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logging.error(f"[digest] Loop error: {e}")
            await asyncio.sleep(300)


# ============== ADMIN: SETUP (Yeni site kurulumu) ==============

async def _seed_defaults_for_site(site_id: str, user: dict) -> dict:
    """Inline seed of default kasalar + payment methods for a new site. Idempotent-ish (skip if already seeded)."""
    existing_kasa = await db.cash_registers.count_documents({"site_id": site_id})
    if existing_kasa > 0:
        return {"skipped": True}
    default_kasalar = [
        {"name": "Ana Kasa", "type": "main", "initial_balance": 0.0, "order": 0},
        {"name": "Finans Kasası", "type": "finance", "initial_balance": 0.0, "order": 1},
    ]
    kasa_ids = {}
    for k in default_kasalar:
        obj = CashRegister(site_id=site_id, **k)
        await db.cash_registers.insert_one(obj.model_dump())
        kasa_ids[k["name"]] = obj.id
    default_methods = [
        {"name": "Papara", "cash_register_id": kasa_ids["Ana Kasa"], "deposit_commission_pct": 0.0, "withdrawal_commission_pct": 0.0, "order": 0},
        {"name": "Havale", "cash_register_id": kasa_ids["Ana Kasa"], "deposit_commission_pct": 0.0, "withdrawal_commission_pct": 0.0, "order": 1},
    ]
    for m in default_methods:
        obj = PaymentMethod(site_id=site_id, **m)
        await db.payment_methods.insert_one(obj.model_dump())
    return {"kasa_count": len(default_kasalar), "method_count": len(default_methods)}


@api_router.post("/admin/setup")
async def admin_setup_new_site(inp: SetupInput, user: dict = Depends(require_admin)):
    """Yeni site kurulum akışı:
    1. Site oluştur (type: online/sokak)
    2. Varsayılan kasalar + ödeme yöntemlerini seed'le
    3. İlk site_credit kaydını aç (verilen kredi tutarı)
    4. Admin Telegram grubuna kurulum bildirimi gönder (fire-and-forget)
    """
    name = (inp.name or "").strip()
    if not name:
        raise HTTPException(400, "Site adı gerekli")
    if inp.amount <= 0:
        raise HTTPException(400, "Kredi miktarı 0'dan büyük olmalı")
    if inp.commission_pct < 0:
        raise HTTPException(400, "Komisyon oranı negatif olamaz")
    if inp.type not in ("online", "sokak"):
        raise HTTPException(400, "type 'online' veya 'sokak' olmalı")
    if inp.setup_fee and inp.setup_fee < 0:
        raise HTTPException(400, "Kurulum ücreti negatif olamaz")
    if inp.setup_fee and inp.setup_fee > 0:
        if not inp.setup_fee_partner_name or inp.setup_fee_partner_name not in PARTNER_KASAS:
            raise HTTPException(400, f"Kurulum ücreti için geçerli bir kasa seçin. Geçerli: {PARTNER_KASAS}")
    # Uniqueness check
    dup = await db.sites.find_one({"name": name}, {"_id": 0, "id": 1})
    if dup:
        raise HTTPException(400, f"'{name}' adında bir site zaten var")

    # 1) Create the site
    site = Site(name=name, type=inp.type, active=True)
    await db.sites.insert_one(site.model_dump())

    # 2) Seed defaults (best-effort)
    seeded = await _seed_defaults_for_site(site.id, user)

    # 3) Initial site credit
    debt = round(inp.amount * inp.commission_pct / 100.0, 2)
    credit = SiteCredit(
        site_id=site.id,
        amount=float(inp.amount),
        commission_pct=float(inp.commission_pct),
        debt=debt,
        note=inp.note,
        date=datetime.now(timezone.utc).date().isoformat(),
        created_by_email=user["email"],
    )
    await db.site_credits.insert_one(credit.model_dump())

    # 3b) Setup fee → partner_kasa movement (income for the selected kasa)
    setup_fee_movement = None
    if inp.setup_fee and inp.setup_fee > 0:
        mv = PartnerKasaMovement(
            kasa=inp.setup_fee_partner_name,
            type="setup_fee",
            amount=round(float(inp.setup_fee), 2),  # POSITIVE = income
            note=f"Kurulum ücreti — {site.name}",
            date=datetime.now(timezone.utc).date().isoformat(),
            site_id=site.id,
            created_by_email=user["email"],
        )
        mv_dict = mv.model_dump()
        mv_dict["related_site_id"] = site.id
        await db.partner_kasa_movements.insert_one(mv_dict)
        setup_fee_movement = {"kasa": inp.setup_fee_partner_name, "amount": float(inp.setup_fee)}

    # 4) Audit + Telegram notification
    await log_audit(user, "site.setup", "site", site.id, target_name=site.name,
                    site_id=site.id,
                    details={"type": inp.type, "amount": inp.amount, "pct": inp.commission_pct,
                             "credit_id": credit.id, "seeded": seeded,
                             "setup_fee": inp.setup_fee, "setup_fee_partner_name": inp.setup_fee_partner_name})

    def _fmt_try(n: float) -> str:
        return f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    type_label = "Online" if inp.type == "online" else "Sokak"
    msg_lines = [
        "*Playspintech — Yeni Site Kurulumu*",
        f"_Site:_ *{site.name}*",
        f"_Tip:_ `{type_label}`",
        f"_Kredi:_ ₺{_fmt_try(float(inp.amount))}"
        + (f" · Komisyon: %{inp.commission_pct:g} (Borç: ₺{_fmt_try(debt)})" if inp.commission_pct else ""),
    ]
    if setup_fee_movement:
        msg_lines.append(
            f"_Kurulum Ücreti:_ ₺{_fmt_try(setup_fee_movement['amount'])} → *{setup_fee_movement['kasa']}* kasasına gelir"
        )
    msg_lines.append("_Kurulum:_ Varsayılan kasalar + ödeme yöntemleri hazır ✓")
    msg = "\n".join(msg_lines)
    tg_result = await _admin_notify("site_setup", msg)

    return {
        "site": site.model_dump(),
        "credit": {**credit.model_dump(), "site_name": site.name},
        "setup_fee": setup_fee_movement,
        "seeded": seeded,
        "telegram": tg_result,
    }


# ============== ADMIN: REPORT (Gelir-Gider) ==============

@api_router.get("/admin/report")
async def admin_report(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    site_type: Optional[str] = Query(None, description="online | sokak | (empty=all)"),
    user: dict = Depends(require_admin),
):
    today = date.today()
    if not date_from:
        date_from = today.replace(day=1).isoformat()
    if not date_to:
        _, last = monthrange(today.year, today.month)
        date_to = today.replace(day=last).isoformat()

    # Site filter (by type)
    site_docs = await db.sites.find({}, {"_id": 0, "id": 1, "name": 1, "type": 1}).to_list(1000)
    if site_type in ("online", "sokak"):
        allowed_site_ids = {s["id"] for s in site_docs if s.get("type") == site_type}
    else:
        allowed_site_ids = {s["id"] for s in site_docs}
    site_map = {s["id"]: s for s in site_docs}

    # --- INCOME: partner_kasa credit_payment + setup_fee movements in date range ---
    income_by_partner: Dict[str, float] = {p: 0.0 for p in PARTNER_KASAS}
    income_by_site: Dict[str, float] = {}
    total_income = 0.0
    inc_cursor = db.partner_kasa_movements.find({
        "type": {"$in": ["credit_payment", "setup_fee"]},
        "date": {"$gte": date_from, "$lte": date_to},
    }, {"_id": 0})
    async for m in inc_cursor:
        sid = m.get("site_id")
        if sid and sid not in allowed_site_ids:
            continue
        amt = float(m.get("amount") or 0)
        total_income += amt
        kasa = m.get("kasa")
        if kasa in income_by_partner:
            income_by_partner[kasa] += amt
        if sid:
            income_by_site[sid] = income_by_site.get(sid, 0.0) + amt

    # --- EXPENSES: admin_payments in date range ---
    expenses_by_partner: Dict[str, float] = {p: 0.0 for p in PARTNER_KASAS}
    expenses_by_category: Dict[str, float] = {}
    total_expense = 0.0
    exp_cursor = db.admin_payments.find({
        "date": {"$gte": date_from, "$lte": date_to},
    }, {"_id": 0})
    async for p in exp_cursor:
        amt = float(p.get("amount") or 0)
        total_expense += amt
        pn = p.get("partner_name")
        if pn in expenses_by_partner:
            expenses_by_partner[pn] += amt
        cat = p.get("category") or "Diğer"
        expenses_by_category[cat] = expenses_by_category.get(cat, 0.0) + amt

    # --- Daily trend ---
    daily: Dict[str, Dict[str, float]] = {}
    inc_cursor = db.partner_kasa_movements.find({
        "type": {"$in": ["credit_payment", "setup_fee"]},
        "date": {"$gte": date_from, "$lte": date_to},
    }, {"_id": 0, "date": 1, "amount": 1, "site_id": 1})
    async for m in inc_cursor:
        sid = m.get("site_id")
        if sid and sid not in allowed_site_ids:
            continue
        d = m.get("date") or ""
        entry = daily.setdefault(d, {"income": 0.0, "expense": 0.0})
        entry["income"] += float(m.get("amount") or 0)
    exp_cursor = db.admin_payments.find({
        "date": {"$gte": date_from, "$lte": date_to},
    }, {"_id": 0, "date": 1, "amount": 1})
    async for p in exp_cursor:
        d = p.get("date") or ""
        entry = daily.setdefault(d, {"income": 0.0, "expense": 0.0})
        entry["expense"] += float(p.get("amount") or 0)
    daily_list = [{"date": d, "income": round(v["income"], 2), "expense": round(v["expense"], 2),
                   "net": round(v["income"] - v["expense"], 2)}
                  for d, v in sorted(daily.items())]

    # Site breakdown for income
    site_breakdown = [
        {"site_id": sid, "site_name": site_map.get(sid, {}).get("name", "?"),
         "type": site_map.get(sid, {}).get("type"), "income": round(amt, 2)}
        for sid, amt in sorted(income_by_site.items(), key=lambda x: -x[1])
    ]

    return {
        "date_from": date_from,
        "date_to": date_to,
        "site_type": site_type or None,
        "totals": {
            "income": round(total_income, 2),
            "expense": round(total_expense, 2),
            "net": round(total_income - total_expense, 2),
        },
        "income_by_partner": [{"partner_name": p, "amount": round(v, 2)} for p, v in income_by_partner.items()],
        "expenses_by_partner": [{"partner_name": p, "amount": round(v, 2)} for p, v in expenses_by_partner.items()],
        "expenses_by_category": [{"category": c, "amount": round(v, 2)} for c, v in sorted(expenses_by_category.items(), key=lambda x: -x[1])],
        "site_breakdown": site_breakdown,
        "daily": daily_list,
    }


@api_router.get("/admin/report/export.csv")
async def admin_report_export_csv(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    site_type: Optional[str] = Query(None),
    user: dict = Depends(require_admin),
):
    data = await admin_report(date_from, date_to, site_type, user)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Playspintech Admin — Gelir/Gider Raporu"])
    writer.writerow([f"Dönem: {data['date_from']} → {data['date_to']}"])
    if data.get("site_type"):
        writer.writerow([f"Site Tipi Filtresi: {data['site_type']}"])
    writer.writerow([])
    writer.writerow(["ÖZET"])
    writer.writerow(["Toplam Gelir", f"{data['totals']['income']:.2f}"])
    writer.writerow(["Toplam Gider", f"{data['totals']['expense']:.2f}"])
    writer.writerow(["Net Kâr", f"{data['totals']['net']:.2f}"])
    writer.writerow([])
    writer.writerow(["GELİR — Ortak Kasa Bazlı"])
    writer.writerow(["Ortak Kasa", "Tutar (TRY)"])
    for row in data["income_by_partner"]:
        writer.writerow([row["partner_name"], f"{row['amount']:.2f}"])
    writer.writerow([])
    writer.writerow(["GİDER — Ortak Kasa Bazlı"])
    writer.writerow(["Ortak Kasa", "Tutar (TRY)"])
    for row in data["expenses_by_partner"]:
        writer.writerow([row["partner_name"], f"{row['amount']:.2f}"])
    writer.writerow([])
    writer.writerow(["GİDER — Kategori Bazlı"])
    writer.writerow(["Kategori", "Tutar (TRY)"])
    for row in data["expenses_by_category"]:
        writer.writerow([row["category"], f"{row['amount']:.2f}"])
    writer.writerow([])
    writer.writerow(["SİTE BAZLI GELİR"])
    writer.writerow(["Site", "Tip", "Tutar (TRY)"])
    for row in data["site_breakdown"]:
        writer.writerow([row["site_name"], row.get("type") or "", f"{row['income']:.2f}"])
    writer.writerow([])
    writer.writerow(["GÜNLÜK TREND"])
    writer.writerow(["Tarih", "Gelir", "Gider", "Net"])
    for row in data["daily"]:
        writer.writerow([row["date"], f"{row['income']:.2f}", f"{row['expense']:.2f}", f"{row['net']:.2f}"])
    fname_from = date_from or "hepsi"
    fname_to = date_to or "hepsi"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="admin_rapor_{fname_from}_{fname_to}.csv"'},
    )


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


# ============== SCRAPER (Backoffice → Daily Entry Automation) ==============

from cryptography.fernet import Fernet, InvalidToken
from scraper import scrape_playspintech_backoffice, ScrapeResult, test_login_only, DEBUG_DIR as SCRAPER_DEBUG_DIR
from fastapi.responses import FileResponse


def _get_fernet() -> Fernet:
    key = os.environ.get("SCRAPER_ENC_KEY")
    if not key:
        raise HTTPException(500, "SCRAPER_ENC_KEY tanımlı değil — .env'e ekleyin")
    return Fernet(key.encode() if isinstance(key, str) else key)


def _enc(secret: str) -> str:
    return _get_fernet().encrypt(secret.encode()).decode()


def _dec(cipher: str) -> str:
    try:
        return _get_fernet().decrypt(cipher.encode()).decode()
    except InvalidToken:
        raise HTTPException(500, "Şifrelenmiş kimlik bilgisi okunamadı (anahtar değişmiş olabilir)")


# ---- Models ----

class ScraperMapping(BaseModel):
    """Maps source (provider, method) to our internal payment_method_id."""
    provider: str
    method: str
    payment_method_id: str


class ScraperConfigInput(BaseModel):
    enabled: Optional[bool] = None
    base_url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None  # plain — will be encrypted server-side
    deposits_path: Optional[str] = None
    withdrawals_path: Optional[str] = None
    mappings: Optional[List[ScraperMapping]] = None


DEFAULT_DEPOSITS_PATH = "/transactions/deposits"
DEFAULT_WITHDRAWALS_PATH = "/transactions/withdrawals"


def _scraper_public(doc: dict) -> dict:
    """Return a config safe to send to the frontend (no password material)."""
    doc = doc or {}
    return {
        "site_id": doc.get("site_id"),
        "enabled": bool(doc.get("enabled")),
        "base_url": doc.get("base_url") or "",
        "username": doc.get("username") or "",
        "password_set": bool(doc.get("password_enc")),
        "deposits_path": doc.get("deposits_path") or DEFAULT_DEPOSITS_PATH,
        "withdrawals_path": doc.get("withdrawals_path") or DEFAULT_WITHDRAWALS_PATH,
        "mappings": doc.get("mappings") or [],
        "last_run_at": doc.get("last_run_at"),
        "last_run_status": doc.get("last_run_status"),
        "last_run_error": doc.get("last_run_error"),
        "last_run_summary": doc.get("last_run_summary"),
    }


# ---- CRUD endpoints (admin only) ----


@api_router.get("/admin/scraper/{site_id}")
async def get_scraper_config(site_id: str, user: dict = Depends(require_admin)):
    site = await db.sites.find_one({"id": site_id}, {"_id": 0, "id": 1, "name": 1})
    if not site:
        raise HTTPException(404, "Site bulunamadı")
    doc = await db.scraper_configs.find_one({"site_id": site_id}, {"_id": 0}) or {"site_id": site_id}
    return _scraper_public(doc)


@api_router.put("/admin/scraper/{site_id}")
async def put_scraper_config(site_id: str, inp: ScraperConfigInput, user: dict = Depends(require_admin)):
    site = await db.sites.find_one({"id": site_id}, {"_id": 0, "id": 1})
    if not site:
        raise HTTPException(404, "Site bulunamadı")

    now = datetime.now(timezone.utc).isoformat()
    update: dict = {"updated_at": now}
    if inp.enabled is not None:
        update["enabled"] = bool(inp.enabled)
    if inp.base_url is not None:
        update["base_url"] = inp.base_url.strip().rstrip("/")
    if inp.username is not None:
        update["username"] = inp.username.strip()
    if inp.password:  # only re-encrypt if new plain password provided
        update["password_enc"] = _enc(inp.password)
    if inp.deposits_path is not None:
        update["deposits_path"] = inp.deposits_path.strip() or DEFAULT_DEPOSITS_PATH
    if inp.withdrawals_path is not None:
        update["withdrawals_path"] = inp.withdrawals_path.strip() or DEFAULT_WITHDRAWALS_PATH
    if inp.mappings is not None:
        # Validate all payment_method_ids belong to this site
        pm_ids = [m.payment_method_id for m in inp.mappings]
        valid = await db.payment_methods.find(
            {"site_id": site_id, "id": {"$in": pm_ids}}, {"_id": 0, "id": 1}
        ).to_list(1000)
        valid_ids = {p["id"] for p in valid}
        for m in inp.mappings:
            if m.payment_method_id not in valid_ids:
                raise HTTPException(400, f"Ödeme yöntemi bulunamadı: {m.payment_method_id}")
        update["mappings"] = [m.model_dump() for m in inp.mappings]

    await db.scraper_configs.update_one(
        {"site_id": site_id},
        {"$set": update, "$setOnInsert": {"site_id": site_id, "created_at": now}},
        upsert=True,
    )
    await log_audit(
        user, "scraper.config", "scraper_config", site_id,
        details={k: (v if k != "password_enc" else "<updated>") for k, v in update.items()},
        site_id=site_id,
    )
    doc = await db.scraper_configs.find_one({"site_id": site_id}, {"_id": 0})
    return _scraper_public(doc)


@api_router.get("/admin/scraper")
async def list_scraper_configs(user: dict = Depends(require_admin)):
    """List all sites with their scraper config status."""
    sites = await db.sites.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    configs = {c["site_id"]: c async for c in db.scraper_configs.find({}, {"_id": 0})}
    out = []
    for s in sites:
        c = configs.get(s["id"], {"site_id": s["id"]})
        out.append({**_scraper_public(c), "site_name": s.get("name")})
    return out


# ---- Scrape execution (writes to transactions) ----


async def _apply_scrape_to_transactions(
    site_id: str, cfg: dict, target_date_iso: str, result: ScrapeResult, user_email: str = "system"
) -> dict:
    """Given a ScrapeResult, upsert into `transactions` collection for that day+site.
    Groups by (provider, method) → payment_method_id via cfg.mappings.
    Returns per-mapping summary + unmapped list.
    """
    mappings = cfg.get("mappings") or []
    # Build lookup: normalized (provider, method) → payment_method_id
    lut: dict = {}
    for m in mappings:
        key = (m["provider"].strip().lower(), m["method"].strip().lower())
        lut[key] = m["payment_method_id"]

    # Load site payment methods for name display
    pms = await db.payment_methods.find({"site_id": site_id}, {"_id": 0}).to_list(1000)
    pm_by_id = {p["id"]: p for p in pms}

    # Aggregate deposits/withdrawals per payment_method_id
    per_pm: dict = {}  # {pm_id: {"deposit":x, "withdrawal":y}}
    unmapped: List[dict] = []
    for (provider, method, tur_key), amount in result.aggregates.items():
        pm_id = lut.get((provider.strip().lower(), method.strip().lower()))
        if not pm_id:
            unmapped.append({"provider": provider, "method": method, "tur": tur_key, "amount": amount})
            continue
        entry = per_pm.setdefault(pm_id, {"deposit": 0.0, "withdrawal": 0.0})
        entry[tur_key] = round(entry.get(tur_key, 0.0) + amount, 2)

    # Upsert transactions per payment_method
    applied = []
    now_iso = datetime.now(timezone.utc).isoformat()
    for pm_id, sums in per_pm.items():
        pm = pm_by_id.get(pm_id)
        if not pm:
            continue
        # Compute commission using payment_method's deposit_commission_pct if defined
        dep = float(sums.get("deposit", 0.0))
        wd = float(sums.get("withdrawal", 0.0))
        commission_pct = float(pm.get("deposit_commission_pct") or pm.get("commission_pct") or 0.0)
        commission = round(dep * commission_pct / 100.0, 2)
        net = round(dep - wd - commission, 2)

        existing = await db.transactions.find_one(
            {"site_id": site_id, "date": target_date_iso, "payment_method_id": pm_id},
            {"_id": 0},
        )
        if existing:
            await db.transactions.update_one(
                {"id": existing["id"]},
                {"$set": {
                    "deposit": dep,
                    "withdrawal": wd,
                    "commission": commission,
                    "net": net,
                    "note": f"Scraper (auto) — {now_iso}",
                }},
            )
        else:
            obj = {
                "id": uid(),
                "site_id": site_id,
                "date": target_date_iso,
                "payment_method_id": pm_id,
                "deposit": dep,
                "withdrawal": wd,
                "commission": commission,
                "net": net,
                "note": "Scraper (auto)",
                "created_at": now_iso,
            }
            await db.transactions.insert_one(obj)

        applied.append({
            "payment_method_id": pm_id,
            "payment_method_name": pm.get("name"),
            "deposit": dep,
            "withdrawal": wd,
            "commission": commission,
            "net": net,
        })

    return {
        "applied": applied,
        "unmapped": unmapped,
        "row_count": len(result.rows),
    }


async def _run_scraper_for_site(site_id: str, target_date_iso: str, triggered_by: str = "cron") -> dict:
    """Fetch config, decrypt password, execute scraper, apply to DB, log status."""
    cfg = await db.scraper_configs.find_one({"site_id": site_id}, {"_id": 0}) or {}
    site = await db.sites.find_one({"id": site_id}, {"_id": 0}) or {}
    site_name = site.get("name", site_id)

    if not cfg.get("enabled"):
        return {"ok": False, "error": "disabled"}
    if not (cfg.get("base_url") and cfg.get("username") and cfg.get("password_enc")):
        return {"ok": False, "error": "incomplete_config"}

    try:
        password = _dec(cfg["password_enc"])
    except HTTPException as e:
        return {"ok": False, "error": f"decrypt_failed: {e.detail}"}

    result = await scrape_playspintech_backoffice(
        base_url=cfg["base_url"],
        username=cfg["username"],
        password=password,
        target_iso_date=target_date_iso,
        deposits_path=cfg.get("deposits_path") or DEFAULT_DEPOSITS_PATH,
        withdrawals_path=cfg.get("withdrawals_path") or DEFAULT_WITHDRAWALS_PATH,
    )

    now = datetime.now(timezone.utc).isoformat()
    if not result.ok:
        summary = {"error": result.error, "target_date": target_date_iso, "triggered_by": triggered_by, "debug_screenshot": result.debug_screenshot}
        await db.scraper_configs.update_one(
            {"site_id": site_id},
            {"$set": {
                "last_run_at": now,
                "last_run_status": "failed",
                "last_run_error": result.error,
                "last_run_summary": summary,
            }},
        )
        # Telegram error notice
        try:
            await _admin_notify(
                "site_setup",  # reuse category (admin_payment_created also OK). Use dedicated hook.
                f"*Scraper — Hata* ❌\n_Site:_ `{site_name}`\n_Gün:_ `{target_date_iso}`\n_Hata:_ `{result.error}`",
            )
        except Exception:
            pass
        return {"ok": False, "error": result.error, "target_date": target_date_iso, "debug_screenshot": result.debug_screenshot}

    applied_summary = await _apply_scrape_to_transactions(site_id, cfg, target_date_iso, result)
    summary = {**applied_summary, "target_date": target_date_iso, "triggered_by": triggered_by}
    await db.scraper_configs.update_one(
        {"site_id": site_id},
        {"$set": {
            "last_run_at": now,
            "last_run_status": "success",
            "last_run_error": None,
            "last_run_summary": summary,
        }},
    )
    # Telegram success digest
    try:
        lines = [
            f"*Scraper — Tamamlandı* ✅",
            f"_Site:_ `{site_name}`",
            f"_Gün:_ `{target_date_iso}`",
            f"_Satır:_ {applied_summary['row_count']}",
            "",
        ]
        for a in applied_summary["applied"]:
            lines.append(
                f"• {a['payment_method_name']}: Y ₺{_amt(a['deposit'])} · Ç ₺{_amt(a['withdrawal'])} · Kom ₺{_amt(a['commission'])} · Net ₺{_amt(a['net'])}"
            )
        if applied_summary["unmapped"]:
            lines.append("")
            lines.append("_Eşlenmemiş kaynaklar:_")
            for u in applied_summary["unmapped"]:
                lines.append(f"  · {u['provider']} · {u['method']} ({u['tur']}) → ₺{_amt(u['amount'])}")
        await _admin_notify("site_setup", "\n".join(lines))
    except Exception:
        pass
    return {"ok": True, **applied_summary, "target_date": target_date_iso}


class ScraperRunInput(BaseModel):
    target_date: Optional[str] = None  # YYYY-MM-DD; defaults to yesterday


@api_router.post("/admin/scraper/{site_id}/test-connection")
async def test_scraper_connection(site_id: str, user: dict = Depends(require_admin)):
    """Quick test: attempt login only. Uses currently-saved credentials. No data extraction."""
    cfg = await db.scraper_configs.find_one({"site_id": site_id}, {"_id": 0}) or {}
    if not (cfg.get("base_url") and cfg.get("username") and cfg.get("password_enc")):
        raise HTTPException(400, "URL / kullanıcı adı / şifre eksik — önce kaydet")
    try:
        password = _dec(cfg["password_enc"])
    except HTTPException as e:
        return {"ok": False, "message": f"Şifre çözülemedi: {e.detail}"}
    result = await test_login_only(cfg["base_url"], cfg["username"], password)
    await log_audit(user, "scraper.test_connection", "scraper_config", site_id,
                    details={"ok": result.get("ok")}, site_id=site_id)
    return result


@api_router.get("/admin/scraper/debug/{filename}")
async def get_scraper_debug_screenshot(filename: str, user: dict = Depends(require_admin)):
    """Serve a debug screenshot captured during a failed login/scrape."""
    # Prevent path traversal
    if "/" in filename or ".." in filename or not filename.endswith(".png"):
        raise HTTPException(400, "Geçersiz dosya adı")
    fpath = os.path.join(SCRAPER_DEBUG_DIR, filename)
    if not os.path.isfile(fpath):
        raise HTTPException(404, "Görüntü bulunamadı")
    return FileResponse(fpath, media_type="image/png")


@api_router.post("/admin/scraper/{site_id}/run")
async def run_scraper_now(site_id: str, inp: ScraperRunInput, user: dict = Depends(require_admin)):
    """Manual trigger — scrapes yesterday (or the specified date) for a single site."""
    target = inp.target_date or (date.today() - timedelta(days=1)).isoformat()
    # Validate format
    try:
        datetime.strptime(target, "%Y-%m-%d")
    except Exception:
        raise HTTPException(400, "Geçersiz tarih (YYYY-MM-DD)")
    result = await _run_scraper_for_site(site_id, target, triggered_by=f"manual:{user.get('email')}")
    await log_audit(user, "scraper.run", "scraper_config", site_id,
                    details={"target_date": target, "ok": result.get("ok")}, site_id=site_id)
    return result


class ScraperBackfillInput(BaseModel):
    start_date: str  # YYYY-MM-DD (inclusive)
    end_date: Optional[str] = None  # YYYY-MM-DD (inclusive). Defaults to yesterday.


@api_router.post("/admin/scraper/{site_id}/backfill")
async def backfill_scraper(site_id: str, inp: ScraperBackfillInput, user: dict = Depends(require_admin)):
    """Sequentially scrape a date range (inclusive). Capped at 62 days to avoid runaway.
    Returns per-day result summaries."""
    try:
        start = datetime.strptime(inp.start_date, "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(400, "start_date geçersiz (YYYY-MM-DD)")
    end = (date.today() - timedelta(days=1)) if not inp.end_date else datetime.strptime(inp.end_date, "%Y-%m-%d").date()
    if end < start:
        raise HTTPException(400, "end_date, start_date'den küçük olamaz")
    days = (end - start).days + 1
    if days > 62:
        raise HTTPException(400, f"Aralık çok geniş: {days} gün. Maksimum 62 gün.")

    results = []
    cur = start
    while cur <= end:
        iso = cur.isoformat()
        try:
            r = await _run_scraper_for_site(site_id, iso, triggered_by=f"backfill:{user.get('email')}")
        except Exception as e:
            r = {"ok": False, "error": str(e), "target_date": iso}
        results.append({"date": iso, **{k: v for k, v in r.items() if k != "target_date"}})
        cur = cur + timedelta(days=1)

    ok_count = sum(1 for r in results if r.get("ok"))
    await log_audit(
        user, "scraper.backfill", "scraper_config", site_id,
        details={"start": start.isoformat(), "end": end.isoformat(), "days": days, "ok_count": ok_count},
        site_id=site_id,
    )
    return {"days": days, "ok_count": ok_count, "fail_count": days - ok_count, "results": results}


async def _scraper_daily_loop():
    """Background task: at 01:00 Europe/Istanbul (22:00 UTC), scrape yesterday for all enabled sites."""
    while True:
        try:
            now = datetime.now(timezone.utc)
            target = now.replace(hour=22, minute=0, second=0, microsecond=0)
            if target <= now:
                target = target + timedelta(days=1)
            sleep_sec = (target - now).total_seconds()
            logging.info(f"[scraper] Next daily run in {int(sleep_sec / 60)} min at {target.isoformat()}")
            await asyncio.sleep(sleep_sec)

            yesterday = (date.today() - timedelta(days=1)).isoformat()
            configs = await db.scraper_configs.find({"enabled": True}, {"_id": 0, "site_id": 1}).to_list(1000)
            for c in configs:
                sid = c.get("site_id")
                if not sid:
                    continue
                logging.info(f"[scraper] Running daily for site {sid} — target {yesterday}")
                try:
                    r = await _run_scraper_for_site(sid, yesterday, triggered_by="cron")
                    logging.info(f"[scraper] Site {sid} result ok={r.get('ok')}")
                except Exception as e:
                    logging.error(f"[scraper] Site {sid} error: {e}")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logging.error(f"[scraper] Loop error: {e}")
            await asyncio.sleep(600)


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

    try:
        await _partner_kasa_backfill_once()
    except Exception as e:
        logger.error(f"Partner kasa backfill hatası: {e}")

    # Start daily credit-reminder background task
    app.state.reminder_task = asyncio.create_task(_daily_reminder_loop())
    app.state.digest_task = asyncio.create_task(_admin_daily_digest_loop())
    app.state.usd_rate_task = asyncio.create_task(_usd_rate_fetch_loop())
    app.state.scraper_task = asyncio.create_task(_scraper_daily_loop())


@app.on_event("shutdown")
async def shutdown_db_client():
    for attr in ("reminder_task", "digest_task", "usd_rate_task", "scraper_task"):
        task = getattr(app.state, attr, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    client.close()

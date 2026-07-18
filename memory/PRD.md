# Playspintech - iGaming Multi-Tenant Finance Suite

## Original Problem Statement
Turkish iGaming operator finance dashboard. Playspintech = provider (parent brand), sites like Etobahis = clients (tenants). Admin creates sites & users; each site logs in and manages its own finances.

## Architecture
- Backend: FastAPI + MongoDB (motor) + PyJWT + bcrypt
- Frontend: React 19 + Tailwind + Shadcn UI + Recharts + AuthContext + protected routes
- Multi-tenant: every domain doc carries `site_id`. Role scopes: `platform_role="admin"` (global) OR `site_id + site_role` (per-site).
- Auth: JWT Bearer tokens (Authorization header), 12h expiry, stored in localStorage.

## Users
- Admin: **harryginny700@gmail.com / Admin123!** (auto-seeded from env)
- Site users: created by admin via Admin Panel → Kullanıcılar → Yeni Kullanıcı

## Features Implemented (2026-02)
### v1.0 - Single-tenant MVP
- Excel-based Sahne finance dashboard converted to web
- KPI cards, cash flow charts, payment method pie chart, kasa comparison bars
- Günlük giriş, kasalar, krediler, giderler, transferler, raporlar, ayarlar
- CSV export (transactions + monthly report)
- Editable payment methods (name, kasa, commissions), reorder up/down
- Editable kasalar & krediciler (name, initial balance, add, delete)

### v2.0 - Multi-tenant SaaS (Playspintech)
- Rebrand: Sahne → Playspintech
- JWT auth (bcrypt hashed passwords)
- Login page with brand panel
- Admin Panel (3 tabs):
  - **Genel Bakış**: Cross-site KPIs + per-site P/L table (click row to enter site)
  - **Siteler**: List/create/delete sites + "Varsayılan Yükle" button (seeds 8 kasalar, 11 payment methods, 4 debtors)
  - **Kullanıcılar**: Create/toggle/delete site users, per-site assignment
- Auto-migration: existing single-tenant data → new "Etobahis" site on first startup
- Admin site switcher in sidebar (view any site as admin)
- Cascade delete: site removal wipes all its data + users
- Full tenant isolation verified by tests (28/28 pass)

### v2.1 - Recent Additions (Feb 2026)
- Password reset flow + admin audit logs
- Dark/Light theme (persisted, respects system preference)
- Mobile responsive layout (drawer menu, mobile grids)
- Custom seed defaults (BP KASA, MULTİPAY KASA, etc.)
- Monthly Rollover (Devir) system with archived snapshots (/api/rollovers/execute)
- Security: brute-force protection, minimum password length, lockout
- Global rename: "Krediler" → "Manueller"
- CSV download auth fix (axios blob response)
- Per-site Telegram Bot integration (custom formatted daily reports)
- **i18n TR/EN language toggle** (i18n context + shared Layout & Login translated; toggle in topbar & login page top-right; localStorage-persisted `pst_lang`; default TR)
- **Telegram preview modals** for daily report and Kasalar (`TelegramPreviewDialog` component + `/api/reports/daily/telegram-preview` & `/api/kasalar/telegram-preview` endpoints); simplified Kasalar Telegram format (one line per kasa + total); Kasalar page "Kasaları Gönder" button
- **Admin Site Credits** (`/admin/krediler`): new `SiteCredit` model + `site_credits` collection; admin-only CRUD endpoints (create/update/toggle-status/delete); Dashboard exposes `site_credit` summary with unpaid_debt banner + last 3 records
- **Site Credit partial payments + Telegram alerts**: `paid_amount` + `payments[]` fields; new `POST /api/admin/site-credits/{id}/payments` endpoint (partial, overpay-guarded, auto-status paid/partial); Telegram notification to the site's group on credit-create and each payment; "Kredi Ödendi" opens a modal asking amount + date; UI shows Ödenmiş / Kalan columns and Kısmi status badge
- **Dark mode date picker fix (2026-02-18)**: Global CSS added in `index.css` sets `color-scheme: dark` on `.dark input[type=date|time|datetime-local|month|week]` so the native `::-webkit-calendar-picker-indicator` icon renders in light color on dark backgrounds. Fixes invisibility across Dashboard, DailyEntry, Reports, Transfers, Expenses, AdminHome, AdminCredits, AdminPartnerKasalar, Credits pages.
- **React Code Review fixes (2026-02-18)**: (a) Wrapped `load`/`loadForDate`/`loadMonthly`/`loadDaily` functions in `useCallback` across 10 pages (Transfers, Settings, Rollovers, Reports, ReceivedCredits, Expenses, Credits, CashRegisters, DailyEntry, AdminHome→AuditLogTab) to fix stale-closure `useEffect` dependency issues; (b) Memoized Context provider values with `useMemo` and wrapped inline callbacks (`login`, `completeLogin2FA`, `refresh`, `logout`, `setAdminSiteId`, `theme.toggle`, `i18n.t`, `i18n.toggle`) in `useCallback` — auth.jsx, theme.jsx, i18n.jsx — to eliminate unnecessary re-renders of all consumers. Regression testing (iteration_6.json) confirmed 100% pass, zero infinite loops, zero console errors.
- **Admin Ödemeler (Payments) page (2026-02-18)**: New admin-only ledger for tracking admin's own expenses/payments. Route `/admin/odemeler`, sidebar nav with Receipt icon. Features:
  - CRUD (create, edit, delete) with date, description, category, amount, note, **partner_name (required)** — payment auto-deducts from selected partner vault via linked `partner_kasa_movements` (type=`admin_payment`, negative amount, `admin_payment_id` back-reference for reversal on update/delete)
  - Date range filter (defaults to current month) + summary KPI cards
  - CSV export with `Ortak Kasa` column
  - Telegram integration: separate admin-scoped bot config (`db.admin_settings` singleton), preview + send. Fire-and-forget from setup as well.
  - Backend endpoints (all `require_admin`): `GET/POST /api/admin/payments`, `PUT/DELETE /api/admin/payments/{pid}`, `GET /api/admin/payments/export.csv`, `GET/PUT /api/admin/payments/telegram-config`, `GET /api/admin/payments/telegram-preview`, `POST /api/admin/payments/send-telegram`
- **Krediler / Kurulum + Yeni Site Kurulumu wizard (2026-02-18)**: Admin Credits page renamed to "Krediler / Kurulum" (i18n TR/EN). New "Yeni Kurulum" button opens a wizard dialog with fields:
  - Kurulacak Site Adı
  - Site Tipi: Online / Sokak (toggle buttons) — new Site.`type` field added (Literal["online","sokak"])
  - Verilecek Kredi (₺) + Komisyon (%)
  - **Kurulum Tutarı (₺) — opsiyonel + Gelir Girecek Kasa** (Playspintech/Harry/Bozo/Memo) → this fee is admins' INCOME. On submit creates a `partner_kasa_movements` doc with type=`setup_fee`, positive amount, related_site_id, on the selected kasa.
  - Not (opsiyonel)
  - On submit `POST /api/admin/setup` creates: site + seeds default kasalar/payment methods + first site_credit + optional setup_fee movement + fires admin Telegram notification (if configured)
- **Admin Rapor sayfası (2026-02-18)**: New admin-only report page at `/admin/rapor` (sidebar nav "Rapor" with BarChart3 icon). Features:
  - KPI cards: Toplam Gelir, Toplam Gider, Net Kâr (color-coded)
  - Günlük Trend bar chart (Recharts) with Gelir vs Gider bars
  - 4 breakdown tables: Gelir-Ortak Kasa Bazlı, Gider-Ortak Kasa Bazlı, Gider-Kategori Bazlı, Site Bazlı Gelir
  - Filters: date range (default current month), Site Tipi (Tümü/Online/Sokak)
  - CSV export with 7 sections (Turkish headers)
  - Backend: `GET /api/admin/report?date_from=&date_to=&site_type=` — income = sum of partner_kasa_movements where type∈{`credit_payment`, `setup_fee`}; expenses = admin_payments docs
  - Backend: `GET /api/admin/report/export.csv` — full CSV export
- **Testing (iteration_7.json + iteration_8.json)**: Combined 57/57 backend pytest + 21/21 initial frontend + 12 admin_setup_report scenarios = **100% PASS**. Zero console errors. Test files: `/app/backend/tests/test_admin_payments.py` + `/app/backend/tests/test_admin_setup_report.py`.

## Backlog (P1/P2)
- P1: Password change / forgot password flow
- P1: Editable admin overview site cards (rename inline)
- P1: Extend i18n dictionary to page bodies (Dashboard, DailyEntry, CashRegisters, Manueller, Giderler, Transferler, Raporlar, Devirler, Ayarlar, AdminHome, Profile) — currently these still render Turkish body text regardless of TR/EN toggle
- P2: Email invitation flow (send credentials via Resend)
- P2: Audit log for admin actions
- P2: Excel export (xlsx with formulas)
- P2: AI monthly summary (Claude Sonnet)
- P2: Multi-currency (USD)

## Auth Endpoints
- POST /api/auth/login {email, password} → {token, user, site}
- GET /api/auth/me → {user, site}

## Admin Endpoints (require platform_role=admin)
- CRUD /api/admin/sites
- POST /api/admin/sites/{id}/seed-defaults
- CRUD /api/admin/users
- GET /api/admin/overview

## Data Endpoints (auth required, site-scoped by JWT-derived user)
- /api/cash-registers, /api/payment-methods, /api/debtors
- /api/transactions (+ /bulk), /api/credits, /api/expenses, /api/transfers
- /api/dashboard, /api/reports/daily, /api/reports/monthly
- /api/export/transactions, /api/export/monthly-report
- Admin may pass ?site_id= to override; site users always scoped to their own site_id

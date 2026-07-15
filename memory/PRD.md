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

"""Playspintech Backoffice web scraper.

Logs into the source site (https://backoffice.playspintech.com/), navigates to the
Deposits (`Yatırım İşlemleri`) and Withdrawals (`Çekim İşlemleri`) pages, extracts
completed transactions (`Durum = Tamamlandı`) filtered to a target date, groups
them by (provider, method), and returns aggregated totals.

Uses Playwright (Chromium headless). All secrets flow in via arguments — the
module itself has no I/O to the app DB (keeps it easy to unit-test / substitute).
"""

from __future__ import annotations
import asyncio
import logging
import os
import re
import uuid as _uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import List, Optional, Tuple

# Ensure Playwright uses the pre-installed browsers path from the pod
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/pw-browsers")

log = logging.getLogger("scraper")

DEBUG_DIR = "/tmp/scraper_debug"
os.makedirs(DEBUG_DIR, exist_ok=True)


@dataclass
class ScrapedRow:
    """One extracted row of the deposits/withdrawals table."""
    provider: str            # Sağlayıcı (ör. Bigpayss)
    method: str              # Yöntem (ör. Havale/EFT)
    tur: str                 # "Yatırım" / "Çekim" / "Bakiye Düzeltme"
    status: str              # "Tamamlandı" / "İşleniyor" / "Başarısız"
    amount: float            # absolute positive TRY amount
    created_at: str          # source's "Oluşturulma" cell as ISO date "YYYY-MM-DD"


@dataclass
class ScrapeResult:
    """Structured result returned to caller."""
    ok: bool
    target_date: str
    rows: List[ScrapedRow] = field(default_factory=list)
    error: Optional[str] = None
    debug_screenshot: Optional[str] = None  # filename in DEBUG_DIR, or None
    # Aggregated: {(provider, method, tur_key): total_amount}
    # tur_key ∈ {"deposit", "withdrawal"}
    aggregates: dict = field(default_factory=dict)


# ---------- Utility parsers ----------

_TRY_RE = re.compile(r"[-+]?\s*(?:₺|TL)?\s*([\d\.,]+)")


def _parse_try_amount(text: str) -> float:
    """Parse "₺1.234,56" / "-₺500,00" / "+₺460,07" → 1234.56 (absolute)."""
    if not text:
        return 0.0
    m = _TRY_RE.search(text)
    if not m:
        return 0.0
    num = m.group(1).replace(".", "").replace(",", ".")
    try:
        return abs(float(num))
    except Exception:
        return 0.0


def _norm(s: str) -> str:
    """Normalize provider/method/status text (strip, lowercase, collapse spaces)."""
    return re.sub(r"\s+", " ", (s or "")).strip()


def _tur_key(tur: str) -> Optional[str]:
    t = (tur or "").strip().lower()
    if "yatır" in t:  # Yatırım
        return "deposit"
    if "çekim" in t or "cekim" in t:
        return "withdrawal"
    return None  # Bakiye düzeltme etc. → skipped


def _iso_date_from_source_created(cell_text: str) -> Optional[str]:
    """Source shows "2026-08-06 23:03:09" → return "2026-08-06"."""
    if not cell_text:
        return None
    cell_text = cell_text.strip()
    m = re.match(r"(\d{4}-\d{2}-\d{2})", cell_text)
    if m:
        return m.group(1)
    # Try Turkish DD.MM.YYYY
    m = re.match(r"(\d{2})[./-](\d{2})[./-](\d{4})", cell_text)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{mo}-{d}"
    return None


# ---------- Core Playwright flow ----------


async def _login(page, base_url: str, username: str, password: str, timeout_ms: int = 30000):
    """Log into backoffice via /login form."""
    login_url = base_url.rstrip("/") + "/login"
    log.info(f"[scraper] Navigating to {login_url}")
    await page.goto(login_url, wait_until="domcontentloaded", timeout=timeout_ms)
    # Fill known input names (fallback to type selectors if names differ)
    try:
        await page.wait_for_selector('input[name="username"], input[name="email"]', timeout=timeout_ms)
    except Exception:
        raise RuntimeError("Login formu bulunamadı — URL'yi kontrol edin (Base URL doğru mu?)")

    if await page.locator('input[name="username"]').count() > 0:
        await page.fill('input[name="username"]', username)
    else:
        await page.fill('input[name="email"]', username)

    if await page.locator('input[name="password"]').count() > 0:
        await page.fill('input[name="password"]', password)
    else:
        await page.fill('input[type="password"]', password)

    await page.click('button[type="submit"]')
    # Wait for either navigation away from /login OR an error toast/alert
    try:
        await page.wait_for_url(lambda url: "/login" not in url, timeout=timeout_ms)
    except Exception:
        # Try to surface an on-page error message if visible
        err = None
        try:
            for sel in ['[role="alert"]', '.text-destructive', '[data-sonner-toast]']:
                loc = page.locator(sel)
                if await loc.count() > 0:
                    err = (await loc.first.inner_text()).strip()
                    if err:
                        break
        except Exception:
            pass
        raise RuntimeError(f"Giriş başarısız — {err or 'kimlik bilgileri hatalı olabilir veya captcha var'}")
    log.info(f"[scraper] Logged in, current URL: {page.url}")


async def test_login_only(base_url: str, username: str, password: str,
                          headless: bool = True, timeout_ms: int = 30000) -> dict:
    """Attempt login only; return {ok, message, landing_url?, debug_screenshot?}. No data extraction."""
    from playwright.async_api import async_playwright
    result: dict = {"ok": False, "message": None, "landing_url": None, "debug_screenshot": None}
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=headless, args=["--no-sandbox"])
            ctx = await browser.new_context(locale="tr-TR")
            page = await ctx.new_page()
            page.set_default_timeout(timeout_ms)
            try:
                await _login(page, base_url, username, password, timeout_ms=timeout_ms)
                result["ok"] = True
                result["landing_url"] = page.url
                result["message"] = "Bağlantı başarılı — login yapıldı."
            except Exception as e:
                fname = f"login_fail_{_uuid.uuid4().hex[:8]}.png"
                fpath = os.path.join(DEBUG_DIR, fname)
                try:
                    await page.screenshot(path=fpath, full_page=False)
                    result["debug_screenshot"] = fname
                except Exception:
                    pass
                result["message"] = str(e)
            finally:
                await ctx.close()
                await browser.close()
    except Exception as e:
        result["message"] = f"Tarayıcı başlatılamadı: {e}"
    return result


async def _extract_table_rows(page, target_iso_date: str, timeout_ms: int = 30000) -> List[ScrapedRow]:
    """Extract all visible rows from the current transactions listing table across all pages.

    The page renders a shadcn-style table with columns:
        ID | Oyuncu | Sağlayıcı | Yöntem | Tür | Durum | Tutar | Önceki | Sonraki | Oluşturulma

    Rows are inspected top-down; if we encounter any row whose Oluşturulma date is EARLIER
    than target_iso_date we can stop paginating (source lists newest first).
    """
    rows: List[ScrapedRow] = []
    await page.wait_for_selector("table tbody tr", timeout=timeout_ms)
    seen_earlier = False
    max_pages = 50  # safety cap

    for page_idx in range(max_pages):
        await page.wait_for_timeout(500)  # allow re-render after nav
        # Grab all row texts as an array of arrays (each row = list of cell texts)
        row_data = await page.evaluate(
            """
            () => {
              const rows = Array.from(document.querySelectorAll('table tbody tr'));
              return rows.map(r => Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim()));
            }
            """
        )
        page_rows_added = 0
        for cells in row_data:
            if len(cells) < 10:
                continue
            provider = _norm(cells[2])
            method = _norm(cells[3])
            tur = _norm(cells[4])
            status = _norm(cells[5])
            amount_txt = cells[6]
            created = cells[9]
            iso = _iso_date_from_source_created(created)
            if not iso:
                continue
            if iso < target_iso_date:
                # Newest-first ordering — once we cross the target date going back, we can stop
                seen_earlier = True
                continue
            if iso != target_iso_date:
                # newer than target (today) — skip, keep scanning; we still may need to paginate
                continue
            rows.append(
                ScrapedRow(
                    provider=provider,
                    method=method,
                    tur=tur,
                    status=status,
                    amount=_parse_try_amount(amount_txt),
                    created_at=iso,
                )
            )
            page_rows_added += 1

        log.info(f"[scraper] Page {page_idx+1}: added {page_rows_added} rows in target date")

        if seen_earlier:
            # Done — we've paginated past the target day
            break

        # Try to click "next page" — look for the chevron-right icon button
        next_btn = page.locator('button:has(svg.lucide-chevron-right)').last
        if await next_btn.count() == 0:
            break
        disabled = await next_btn.get_attribute("disabled")
        if disabled is not None:
            break
        try:
            await next_btn.click()
        except Exception as e:
            log.info(f"[scraper] Cannot click next: {e}")
            break

    return rows


async def _navigate_and_extract(page, base_url: str, path: str, target_iso_date: str) -> List[ScrapedRow]:
    url = base_url.rstrip("/") + path
    log.info(f"[scraper] Navigating to {url}")
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(1500)  # let SPA hydrate
    return await _extract_table_rows(page, target_iso_date)


def _aggregate(rows: List[ScrapedRow]) -> dict:
    """Aggregate rows → {(provider, method, tur_key): total_amount}.
    Only status=Tamamlandı and tur_key ∈ {deposit, withdrawal} are summed.
    """
    agg: dict = {}
    for r in rows:
        if r.status.lower() != "tamamlandı":
            continue
        tk = _tur_key(r.tur)
        if not tk:
            continue
        key = (r.provider, r.method, tk)
        agg[key] = round(agg.get(key, 0.0) + r.amount, 2)
    return agg


# ---------- Public entry ----------


async def scrape_playspintech_backoffice(
    base_url: str,
    username: str,
    password: str,
    target_iso_date: str,
    deposits_path: str = "/transactions/deposits",
    withdrawals_path: str = "/transactions/withdrawals",
    headless: bool = True,
    timeout_ms: int = 30000,
) -> ScrapeResult:
    """Main entrypoint. Returns a ScrapeResult (ok=False on any failure).

    NOTE: If the source URLs for deposits/withdrawals differ from the defaults, they
    can be overridden per-site via ScraperConfig.
    """
    from playwright.async_api import async_playwright  # local import — heavy dep

    result = ScrapeResult(ok=False, target_date=target_iso_date)
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=headless, args=["--no-sandbox"])
            ctx = await browser.new_context(locale="tr-TR")
            page = await ctx.new_page()
            page.set_default_timeout(timeout_ms)
            try:
                await _login(page, base_url, username, password, timeout_ms=timeout_ms)

                deposits = await _navigate_and_extract(page, base_url, deposits_path, target_iso_date)
                withdrawals = await _navigate_and_extract(page, base_url, withdrawals_path, target_iso_date)

                all_rows = deposits + withdrawals
                result.rows = all_rows
                result.aggregates = _aggregate(all_rows)
                result.ok = True
            except Exception as inner:
                # Capture screenshot for debugging
                try:
                    fname = f"scrape_fail_{_uuid.uuid4().hex[:8]}.png"
                    fpath = os.path.join(DEBUG_DIR, fname)
                    await page.screenshot(path=fpath, full_page=False)
                    result.debug_screenshot = fname
                except Exception:
                    pass
                raise
            finally:
                await ctx.close()
                await browser.close()
    except Exception as e:
        log.exception("[scraper] Failed")
        result.error = str(e)
    return result

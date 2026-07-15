import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  CalendarClock,
  Wallet,
  Coins,
  Receipt,
  ArrowLeftRight,
  FileBarChart,
  Settings2,
  Activity,
  Shield,
  LogOut,
  Globe,
  ArrowLeft,
  User,
  Sun,
  Moon,
  Menu,
  X,
  Archive,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const siteNav = [
  { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard", testId: "nav-dashboard", end: true },
  { to: "/gunluk", icon: CalendarClock, labelKey: "nav.daily", testId: "nav-daily" },
  { to: "/kasalar", icon: Wallet, labelKey: "nav.kasalar", testId: "nav-kasalar" },
  { to: "/krediler", icon: Coins, labelKey: "nav.krediler", testId: "nav-krediler" },
  { to: "/giderler", icon: Receipt, labelKey: "nav.giderler", testId: "nav-giderler" },
  { to: "/transferler", icon: ArrowLeftRight, labelKey: "nav.transferler", testId: "nav-transferler" },
  { to: "/raporlar", icon: FileBarChart, labelKey: "nav.raporlar", testId: "nav-raporlar" },
  { to: "/devirler", icon: Archive, labelKey: "nav.devirler", testId: "nav-devirler" },
  { to: "/ayarlar", icon: Settings2, labelKey: "nav.ayarlar", testId: "nav-ayarlar" },
];

const adminNav = [
  { to: "/admin", icon: Shield, labelKey: "nav.admin", testId: "nav-admin", end: true },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, site, logout, isAdmin, adminSiteId, setAdminSiteId } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const { lang, t, toggle: toggleLang } = useI18n();
  const [sites, setSites] = useState([]);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      api.get("/admin/sites").then((r) => setSites(r.data)).catch(() => {});
    }
  }, [isAdmin]);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Lock body scroll when drawer open on mobile
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const inAdmin = location.pathname.startsWith("/admin");
  const nav = inAdmin ? adminNav : siteNav;
  const currentSite = isAdmin ? sites.find((s) => s.id === adminSiteId) : site;

  const currentLabel =
    (inAdmin ? adminNav : siteNav).find(
      (n) => (n.end ? n.to === location.pathname : location.pathname.startsWith(n.to))
    );
  const currentLabelText = currentLabel ? t(currentLabel.labelKey) : (inAdmin ? "Admin" : t("nav.dashboard"));

  return (
    <div className="min-h-screen flex bg-background text-foreground" data-testid="app-shell">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          data-testid="mobile-backdrop"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`w-64 md:w-60 shrink-0 border-r border-border bg-background flex flex-col
          fixed inset-y-0 left-0 z-50 h-screen transform transition-transform duration-200
          md:sticky md:top-0 md:translate-x-0
          ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
        data-testid="sidebar"
      >
        <div className="px-5 py-4 md:py-6 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-sm bg-primary flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <div className="font-display text-base font-semibold text-foreground leading-tight">PLAYSPINTECH</div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">iGaming · Finance</div>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden w-8 h-8 rounded-sm border border-border flex items-center justify-center hover:bg-secondary"
            data-testid="drawer-close"
            aria-label={t("drawer.close", "Menüyü kapat")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Admin site switcher / site badge */}
        {isAdmin && !inAdmin && (
          <div className="px-4 py-3 border-b border-border space-y-2">
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{t("sidebar.viewedSite")}</div>
            <Select value={adminSiteId || ""} onValueChange={(v) => setAdminSiteId(v)}>
              <SelectTrigger className="bg-transparent border-border rounded-sm h-8 text-xs" data-testid="site-switcher">
                <SelectValue placeholder={t("sidebar.selectSite")} />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="w-full text-xs justify-start text-muted-foreground hover:text-foreground h-7 gap-2" data-testid="back-to-admin">
              <ArrowLeft className="w-3 h-3" /> {t("nav.backToAdmin")}
            </Button>
          </div>
        )}
        {!isAdmin && currentSite && (
          <div className="px-4 py-3 border-b border-border">
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{t("sidebar.site")}</div>
            <div className="flex items-center gap-1.5 mt-1">
              <Globe className="w-3 h-3 text-primary" />
              <div className="font-display text-sm text-foreground" data-testid="current-site-name">{currentSite.name}</div>
            </div>
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-testid={item.testId}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 md:py-2 rounded-sm text-sm transition-colors duration-150 ${
                  isActive
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                }`
              }
            >
              <item.icon className="w-4 h-4" strokeWidth={2} />
              <span>{t(item.labelKey)}</span>
            </NavLink>
          ))}

          {isAdmin && !inAdmin && (
            <NavLink to="/admin" data-testid="cross-nav-admin" className="flex items-center gap-3 px-3 py-2.5 md:py-2 rounded-sm text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 mt-4 border-t border-border pt-4">
              <Shield className="w-4 h-4" />
              <span>{t("nav.admin")}</span>
            </NavLink>
          )}
          {isAdmin && inAdmin && adminSiteId && (
            <NavLink to="/" data-testid="cross-nav-site" className="flex items-center gap-3 px-3 py-2.5 md:py-2 rounded-sm text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 mt-4 border-t border-border pt-4">
              <LayoutDashboard className="w-4 h-4" />
              <span>{t("nav.goToSite")}</span>
            </NavLink>
          )}
        </nav>

        {/* User footer */}
        <div className="px-4 py-3 border-t border-border">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-sm bg-secondary flex items-center justify-center font-data text-xs text-foreground uppercase">
              {(user?.email?.[0] || "?")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-foreground truncate" data-testid="current-user-email">{user?.email}</div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                {isAdmin ? t("profile.admin") : (user?.site_role || "user")}
              </div>
            </div>
          </div>
          <NavLink to="/profil" data-testid="nav-profil" className={({ isActive }) =>
            `flex items-center gap-2 px-2 h-9 md:h-8 rounded-sm text-xs transition-colors ${
              isActive ? "text-foreground bg-secondary/80" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            }`
          }>
            <User className="w-3.5 h-3.5" /> {t("nav.profil")}
          </NavLink>
          <Button variant="ghost" size="sm" onClick={() => { logout(); navigate("/login"); }} className="w-full justify-start gap-2 h-9 md:h-8 text-xs text-muted-foreground hover:text-foreground mt-1" data-testid="logout-btn">
            <LogOut className="w-3.5 h-3.5" /> {t("nav.logout")}
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 w-full">
        <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl" data-testid="topbar">
          <div className="px-4 md:px-8 h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setMobileOpen(true)}
                className="md:hidden w-9 h-9 rounded-sm border border-border flex items-center justify-center hover:bg-secondary shrink-0"
                data-testid="drawer-open"
                aria-label={t("drawer.open", "Menüyü aç")}
              >
                <Menu className="w-4 h-4" />
              </button>
              <div className="flex items-baseline gap-2 md:gap-3 min-w-0">
                <span className="hidden sm:inline text-[10px] uppercase tracking-[0.25em] text-muted-foreground truncate">
                  {inAdmin ? "Playspintech / Admin" : (currentSite ? `Playspintech / ${currentSite.name}` : "Playspintech")} /
                </span>
                <h1 className="font-display text-base md:text-lg font-medium text-foreground truncate" data-testid="page-title">{currentLabelText}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-3 shrink-0">
              <button
                onClick={toggleLang}
                aria-label={t("lang.toggle", "Dil değiştir")}
                data-testid="lang-toggle"
                title={lang === "tr" ? "Switch to English" : "Türkçe'ye geç"}
                className="h-8 px-2.5 rounded-sm border border-border hover:bg-secondary flex items-center justify-center transition-colors active:scale-95 font-data text-[11px] uppercase tracking-[0.15em] text-foreground"
              >
                {lang === "tr" ? "TR" : "EN"}
              </button>
              <button
                onClick={toggleTheme}
                aria-label={t("theme.toggle", "Tema değiştir")}
                data-testid="theme-toggle"
                className="w-8 h-8 rounded-sm border border-border hover:bg-secondary flex items-center justify-center transition-colors active:scale-95"
              >
                {theme === "dark" ? <Sun className="w-3.5 h-3.5 text-primary" /> : <Moon className="w-3.5 h-3.5 text-primary" />}
              </button>
              <div className="hidden sm:flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[hsl(144_100%_50%)]" />
                <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-data">{t("topbar.connected")}</span>
              </div>
            </div>
          </div>
        </header>
        <main className="px-4 md:px-8 py-6 md:py-8">
          {!inAdmin && isAdmin && !adminSiteId && location.pathname !== "/profil" ? (
            <div className="border border-border rounded-sm bg-card p-8 text-center">
              <Globe className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-display text-lg text-foreground mb-2">{t("topbar.selectSitePrompt")}</h3>
              <p className="text-sm text-muted-foreground mb-4">{t("topbar.selectSiteText")}</p>
              <Button onClick={() => navigate("/admin")} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95">{t("topbar.goToAdmin")}</Button>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}

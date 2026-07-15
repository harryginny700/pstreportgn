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
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
const siteNav = [
  { to: "/", icon: LayoutDashboard, label: "Panel", testId: "nav-dashboard", end: true },
  { to: "/gunluk", icon: CalendarClock, label: "Günlük Giriş", testId: "nav-daily" },
  { to: "/kasalar", icon: Wallet, label: "Kasalar", testId: "nav-kasalar" },
  { to: "/krediler", icon: Coins, label: "Krediler", testId: "nav-krediler" },
  { to: "/giderler", icon: Receipt, label: "Giderler", testId: "nav-giderler" },
  { to: "/transferler", icon: ArrowLeftRight, label: "Transferler", testId: "nav-transferler" },
  { to: "/raporlar", icon: FileBarChart, label: "Raporlar", testId: "nav-raporlar" },
  { to: "/ayarlar", icon: Settings2, label: "Ayarlar", testId: "nav-ayarlar" },
];

const adminNav = [
  { to: "/admin", icon: Shield, label: "Admin Paneli", testId: "nav-admin", end: true },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, site, logout, isAdmin, adminSiteId, setAdminSiteId } = useAuth();
  const [sites, setSites] = useState([]);

  useEffect(() => {
    if (isAdmin) {
      api.get("/admin/sites").then((r) => setSites(r.data)).catch(() => {});
    }
  }, [isAdmin]);

  const inAdmin = location.pathname.startsWith("/admin");
  const nav = inAdmin ? adminNav : siteNav;
  const currentSite = isAdmin
    ? sites.find((s) => s.id === adminSiteId)
    : site;

  const currentLabel =
    (inAdmin ? adminNav : siteNav).find(
      (n) => (n.end ? n.to === location.pathname : location.pathname.startsWith(n.to))
    )?.label || (inAdmin ? "Admin" : "Panel");

  return (
    <div className="min-h-screen flex bg-background text-foreground" data-testid="app-shell">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-border bg-background sticky top-0 h-screen flex flex-col" data-testid="sidebar">
        <div className="px-5 py-6 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-sm bg-primary flex items-center justify-center">
              <Activity className="w-5 h-5 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-display text-base font-semibold text-white leading-tight">PLAYSPINTECH</div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">iGaming · Finance</div>
            </div>
          </div>
        </div>

        {/* Admin site switcher / site badge */}
        {isAdmin && !inAdmin && (
          <div className="px-4 py-3 border-b border-border space-y-2">
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">İncelenen Site</div>
            <Select value={adminSiteId || ""} onValueChange={(v) => setAdminSiteId(v)}>
              <SelectTrigger className="bg-transparent border-border rounded-sm h-8 text-xs" data-testid="site-switcher">
                <SelectValue placeholder="Site seçin" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="w-full text-xs justify-start text-neutral-400 hover:text-white h-7 gap-2" data-testid="back-to-admin">
              <ArrowLeft className="w-3 h-3" /> Admin Paneline Dön
            </Button>
          </div>
        )}
        {!isAdmin && currentSite && (
          <div className="px-4 py-3 border-b border-border">
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Site</div>
            <div className="flex items-center gap-1.5 mt-1">
              <Globe className="w-3 h-3 text-primary" />
              <div className="font-display text-sm text-white" data-testid="current-site-name">{currentSite.name}</div>
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
                `flex items-center gap-3 px-3 py-2 rounded-sm text-sm transition-colors duration-150 ${
                  isActive
                    ? "bg-secondary text-white"
                    : "text-muted-foreground hover:text-white hover:bg-secondary/60"
                }`
              }
            >
              <item.icon className="w-4 h-4" strokeWidth={2} />
              <span>{item.label}</span>
            </NavLink>
          ))}

          {/* Cross-nav shortcuts */}
          {isAdmin && !inAdmin && (
            <NavLink to="/admin" data-testid="cross-nav-admin" className="flex items-center gap-3 px-3 py-2 rounded-sm text-sm text-muted-foreground hover:text-white hover:bg-secondary/60 mt-4 border-t border-border pt-4">
              <Shield className="w-4 h-4" />
              <span>Admin Paneli</span>
            </NavLink>
          )}
          {isAdmin && inAdmin && adminSiteId && (
            <NavLink to="/" data-testid="cross-nav-site" className="flex items-center gap-3 px-3 py-2 rounded-sm text-sm text-muted-foreground hover:text-white hover:bg-secondary/60 mt-4 border-t border-border pt-4">
              <LayoutDashboard className="w-4 h-4" />
              <span>Site Paneline Git</span>
            </NavLink>
          )}
        </nav>

        {/* User footer */}
        <div className="px-4 py-3 border-t border-border">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-sm bg-secondary flex items-center justify-center font-data text-xs text-white uppercase">
              {(user?.email?.[0] || "?")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-white truncate" data-testid="current-user-email">{user?.email}</div>
              <div className="text-[9px] uppercase tracking-widest text-neutral-500">
                {isAdmin ? "Playspintech Admin" : (user?.site_role || "user")}
              </div>
            </div>
          </div>
          <NavLink to="/profil" data-testid="nav-profil" className={({ isActive }) =>
            `flex items-center gap-2 px-2 h-8 rounded-sm text-xs transition-colors ${
              isActive ? "text-white bg-secondary/80" : "text-neutral-400 hover:text-white hover:bg-secondary/60"
            }`
          }>
            <User className="w-3.5 h-3.5" /> Profil & Şifre
          </NavLink>
          <Button variant="ghost" size="sm" onClick={() => { logout(); navigate("/login"); }} className="w-full justify-start gap-2 h-8 text-xs text-neutral-400 hover:text-white mt-1" data-testid="logout-btn">
            <LogOut className="w-3.5 h-3.5" /> Çıkış Yap
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl" data-testid="topbar">
          <div className="px-8 h-14 flex items-center justify-between">
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                {inAdmin ? "Playspintech / Admin" : (currentSite ? `Playspintech / ${currentSite.name}` : "Playspintech")} /
              </span>
              <h1 className="font-display text-lg font-medium text-white" data-testid="page-title">{currentLabel}</h1>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[hsl(144_100%_50%)]" />
              <span className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-data">Bağlı</span>
            </div>
          </div>
        </header>
        <main className="px-8 py-8">
          {!inAdmin && isAdmin && !adminSiteId && location.pathname !== "/profil" ? (
            <div className="border border-border rounded-sm bg-card p-8 text-center">
              <Globe className="w-8 h-8 text-neutral-500 mx-auto mb-3" />
              <h3 className="font-display text-lg text-white mb-2">Bir site seçin</h3>
              <p className="text-sm text-neutral-400 mb-4">Site verilerini görüntülemek için sol menüden bir site seçin veya Admin Panel'e dönün.</p>
              <Button onClick={() => navigate("/admin")} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95">Admin Paneline Git</Button>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}

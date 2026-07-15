import { NavLink, Outlet, useLocation } from "react-router-dom";
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
} from "lucide-react";

const nav = [
  { to: "/", icon: LayoutDashboard, label: "Panel", testId: "nav-dashboard" },
  { to: "/gunluk", icon: CalendarClock, label: "Günlük Giriş", testId: "nav-daily" },
  { to: "/kasalar", icon: Wallet, label: "Kasalar", testId: "nav-kasalar" },
  { to: "/krediler", icon: Coins, label: "Krediler", testId: "nav-krediler" },
  { to: "/giderler", icon: Receipt, label: "Giderler", testId: "nav-giderler" },
  { to: "/transferler", icon: ArrowLeftRight, label: "Transferler", testId: "nav-transferler" },
  { to: "/raporlar", icon: FileBarChart, label: "Raporlar", testId: "nav-raporlar" },
  { to: "/ayarlar", icon: Settings2, label: "Ayarlar", testId: "nav-ayarlar" },
];

export default function Layout() {
  const location = useLocation();
  const current = nav.find((n) => n.to === location.pathname)?.label || "Panel";

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
              <div className="font-display text-base font-semibold text-white leading-tight">SAHNE</div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">FINANS · TR</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
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
        </nav>
        <div className="px-4 py-4 border-t border-border">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-1">Sürüm</div>
          <div className="font-data text-xs text-neutral-400">v1.0 · Live</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl" data-testid="topbar">
          <div className="px-8 h-14 flex items-center justify-between">
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Sahne / </span>
              <h1 className="font-display text-lg font-medium text-white" data-testid="page-title">{current}</h1>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[hsl(144_100%_50%)]" />
              <span className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-data">Bağlı</span>
            </div>
          </div>
        </header>
        <main className="px-8 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

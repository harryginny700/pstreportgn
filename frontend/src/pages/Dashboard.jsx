import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY, fmtDayMonth, todayISO, monthStartISO, monthEndISO } from "@/lib/format";
import KpiCard from "@/components/KpiCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  TrendingDown,
  Percent,
  Wallet,
  Receipt,
  Sparkles,
  Landmark,
  Coins,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import { toast } from "sonner";

const CHART_COLORS = [
  "hsl(144, 100%, 50%)",
  "hsl(345, 100%, 60%)",
  "hsl(186, 100%, 55%)",
  "hsl(53, 98%, 55%)",
  "hsl(280, 100%, 70%)",
  "hsl(24, 100%, 60%)",
  "hsl(200, 100%, 60%)",
  "hsl(160, 80%, 55%)",
  "hsl(320, 80%, 60%)",
  "hsl(60, 90%, 60%)",
  "hsl(100, 80%, 55%)",
];

function TooltipBox({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-black border border-border p-3 rounded-sm text-xs font-data">
      <div className="text-neutral-400 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2" style={{ background: p.color }} />
          <span className="text-neutral-300">{p.name}:</span>
          <span className="text-white">{fmtTRY(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(monthStartISO());
  const [dateTo, setDateTo] = useState(monthEndISO());

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/dashboard", { params: { date_from: dateFrom, date_to: dateTo } });
      setData(r.data);
    } catch (e) {
      toast.error("Panel yüklenemedi");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !data) {
    return <div className="text-neutral-500 text-sm font-data">Yükleniyor...</div>;
  }

  const k = data.kpis;
  const daily = (data.daily_series || []).map((d) => ({
    ...d,
    label: fmtDayMonth(d.date),
  }));

  const pieData = (data.payment_method_distribution || [])
    .filter((p) => p.deposit > 0)
    .map((p) => ({ name: p.name, value: p.deposit }));

  const kasaBars = (data.balances || []).map((b) => ({ name: b.name.replace(" KASA", ""), Bakiye: b.balance }));

  return (
    <div className="space-y-8" data-testid="dashboard-page">
      {/* Filter */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-1">Dönem</div>
          <div className="font-data text-xs text-neutral-400">
            {dateFrom} → {dateTo}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Başlangıç</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40 bg-transparent border-border rounded-sm font-data text-xs"
              data-testid="dashboard-date-from"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Bitiş</label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-40 bg-transparent border-border rounded-sm font-data text-xs"
              data-testid="dashboard-date-to"
            />
          </div>
          <Button
            onClick={load}
            className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 font-medium tracking-tight active:scale-95"
            data-testid="dashboard-apply"
          >
            Uygula
          </Button>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Toplam Yatırım" value={k.total_deposit} tone="green" icon={TrendingUp} testId="kpi-deposit" />
        <KpiCard label="Toplam Çekim" value={k.total_withdrawal} tone="red" icon={TrendingDown} testId="kpi-withdrawal" />
        <KpiCard label="Ödenen Komisyon" value={k.total_commission} tone="yellow" icon={Percent} testId="kpi-commission" />
        <KpiCard label="Net İşlem (Y-Ç-K)" value={k.net_transactions} tone={k.net_transactions >= 0 ? "green" : "red"} icon={Sparkles} testId="kpi-net" />
        <KpiCard label="Giderler" value={k.total_expense} tone="red" icon={Receipt} testId="kpi-expense" />
        <KpiCard label="Krediler +/-" value={k.credits_added - k.credits_paid} tone="cyan" icon={Coins} testId="kpi-credits" hint={`Eklenen ${fmtTRY(k.credits_added)} · Ödenen ${fmtTRY(k.credits_paid)}`} />
        <KpiCard label="Kar / Zarar" value={k.profit_loss} tone={k.profit_loss >= 0 ? "green" : "red"} icon={Landmark} testId="kpi-pnl" />
        <KpiCard label="Toplam Kasa" value={k.total_cash} tone="white" icon={Wallet} testId="kpi-cash-total" />
      </div>

      {/* Cash flow chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 border border-border bg-card rounded-sm p-5" data-testid="cashflow-chart">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Grafik</div>
              <h3 className="font-display text-lg text-white mt-0.5">Nakit Akışı</h3>
            </div>
          </div>
          <div className="h-72">
            {daily.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-neutral-500 font-data">Bu dönemde işlem yok</div>
            ) : (
              <ResponsiveContainer>
                <AreaChart data={daily}>
                  <defs>
                    <linearGradient id="gDep" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(144 100% 50%)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(144 100% 50%)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gWd" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(345 100% 60%)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(345 100% 60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="label" stroke="rgba(255,255,255,0.4)" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                  <YAxis stroke="rgba(255,255,255,0.4)" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                  <Tooltip content={<TooltipBox />} />
                  <Area type="monotone" dataKey="deposit" name="Yatırım" stroke="hsl(144 100% 50%)" fill="url(#gDep)" strokeWidth={2} />
                  <Area type="monotone" dataKey="withdrawal" name="Çekim" stroke="hsl(345 100% 60%)" fill="url(#gWd)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Payment distribution pie */}
        <div className="border border-border bg-card rounded-sm p-5" data-testid="payment-pie">
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Dağılım</div>
            <h3 className="font-display text-lg text-white mt-0.5">Ödeme Yöntemi</h3>
          </div>
          <div className="h-72">
            {pieData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-neutral-500 font-data">Veri yok</div>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="hsl(0 0% 6%)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip content={<TooltipBox />} />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Kasa balances */}
      <div className="border border-border bg-card rounded-sm p-5" data-testid="kasa-bars">
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Kasa</div>
          <h3 className="font-display text-lg text-white mt-0.5">Kasa Bakiyeleri</h3>
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={kasaBars}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="name" stroke="rgba(255,255,255,0.4)" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
              <YAxis stroke="rgba(255,255,255,0.4)" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
              <Tooltip content={<TooltipBox />} />
              <Bar dataKey="Bakiye" radius={[2, 2, 0, 0]}>
                {kasaBars.map((entry, i) => (
                  <Cell key={i} fill={entry.Bakiye >= 0 ? "hsl(144 100% 50%)" : "hsl(345 100% 60%)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

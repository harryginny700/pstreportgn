import { useEffect, useState } from "react";
import { api, API } from "@/lib/api";
import { fmtTRY, fmtDayMonth, fmtDateShort } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Download, FileText } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";

const MONTHS = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];

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

export default function Reports() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [monthly, setMonthly] = useState(null);
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().split("T")[0]);
  const [daily, setDaily] = useState(null);

  const loadMonthly = async () => {
    try {
      const r = await api.get("/reports/monthly", { params: { year, month } });
      setMonthly(r.data);
    } catch (e) { toast.error("Rapor alınamadı"); }
  };
  const loadDaily = async () => {
    try {
      const r = await api.get("/reports/daily", { params: { date: dailyDate } });
      setDaily(r.data);
    } catch (e) { toast.error("Günlük rapor alınamadı"); }
  };

  useEffect(() => { loadMonthly(); }, [year, month]);
  useEffect(() => { loadDaily(); }, [dailyDate]);

  const exportMonthly = () => {
    window.open(`${API}/export/monthly-report?year=${year}&month=${month}`, "_blank");
  };
  const exportRange = () => {
    if (!monthly) return;
    window.open(`${API}/export/transactions?date_from=${monthly.range.from}&date_to=${monthly.range.to}`, "_blank");
  };

  return (
    <div className="space-y-6" data-testid="raporlar-page">
      <Tabs defaultValue="monthly">
        <TabsList className="bg-secondary rounded-sm">
          <TabsTrigger value="monthly" className="rounded-sm text-xs uppercase tracking-[0.2em]" data-testid="reports-tab-monthly">Aylık</TabsTrigger>
          <TabsTrigger value="daily" className="rounded-sm text-xs uppercase tracking-[0.2em]" data-testid="reports-tab-daily">Günlük</TabsTrigger>
        </TabsList>

        <TabsContent value="monthly" className="mt-6 space-y-6">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="flex gap-3 items-end">
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Yıl</label>
                <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-24 bg-transparent border-border rounded-sm font-data h-9 text-center" data-testid="reports-year" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Ay</label>
                <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                  <SelectTrigger className="w-36 bg-transparent border-border rounded-sm h-9" data-testid="reports-month"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={exportRange} variant="outline" className="rounded-sm border-border hover:bg-secondary h-9 gap-2" data-testid="export-tx">
                <Download className="w-4 h-4" /> İşlemler CSV
              </Button>
              <Button onClick={exportMonthly} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95" data-testid="export-monthly">
                <FileText className="w-4 h-4" /> Rapor CSV
              </Button>
            </div>
          </div>

          {monthly && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <SumCard label="Yatırım" value={monthly.summary.deposit} tone="green" testId="rep-deposit" />
                <SumCard label="Çekim" value={monthly.summary.withdrawal} tone="red" testId="rep-withdrawal" />
                <SumCard label="Komisyon" value={monthly.summary.commission} tone="yellow" testId="rep-commission" />
                <SumCard label="Gider" value={monthly.summary.expense} tone="red" testId="rep-expense" />
                <SumCard label="Kar / Zarar" value={monthly.summary.profit_loss} tone={monthly.summary.profit_loss >= 0 ? "green" : "red"} testId="rep-pnl" />
              </div>

              <div className="border border-border bg-card rounded-sm p-5">
                <h3 className="font-display text-lg text-white mb-4">Aylık Nakit Akışı</h3>
                <div className="h-64">
                  {monthly.daily.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-neutral-500 font-data">Bu ayda işlem yok</div>
                  ) : (
                    <ResponsiveContainer>
                      <LineChart data={monthly.daily.map((d) => ({ ...d, label: fmtDayMonth(d.date) }))}>
                        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis dataKey="label" stroke="rgba(255,255,255,0.4)" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                        <YAxis stroke="rgba(255,255,255,0.4)" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                        <Tooltip content={<TooltipBox />} />
                        <Line type="monotone" dataKey="net" name="Net" stroke="hsl(53 98% 55%)" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="profit_loss" name="Kar/Zarar" stroke="hsl(144 100% 55%)" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="border border-border rounded-sm bg-card overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Tarih</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Yatırım</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Çekim</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Komisyon</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Net</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Gider</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Kar/Zarar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthly.daily.length === 0 && (
                      <TableRow className="border-border"><TableCell colSpan={7} className="text-center text-xs text-neutral-500 py-8 font-data">Veri yok</TableCell></TableRow>
                    )}
                    {monthly.daily.map((d) => (
                      <TableRow key={d.date} className="border-border hover:bg-white/[0.02]">
                        <TableCell className="font-data text-xs text-neutral-300">{fmtDateShort(d.date)}</TableCell>
                        <TableCell className="text-right font-data text-sm text-[hsl(144_100%_55%)]">{fmtTRY(d.deposit)}</TableCell>
                        <TableCell className="text-right font-data text-sm text-[hsl(345_100%_65%)]">{fmtTRY(d.withdrawal)}</TableCell>
                        <TableCell className="text-right font-data text-sm text-[hsl(53_98%_60%)]">{fmtTRY(d.commission)}</TableCell>
                        <TableCell className="text-right font-data text-sm text-neutral-200">{fmtTRY(d.net)}</TableCell>
                        <TableCell className="text-right font-data text-sm text-[hsl(345_100%_65%)]">{fmtTRY(d.expense)}</TableCell>
                        <TableCell className={`text-right font-data text-sm ${d.profit_loss >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`}>{fmtTRY(d.profit_loss)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="daily" className="mt-6 space-y-6">
          <div className="flex items-end gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Tarih</label>
              <Input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} className="w-52 bg-transparent border-border rounded-sm font-data h-9" data-testid="reports-daily-date" />
            </div>
          </div>

          {daily && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <SumCard label="Yatırım" value={daily.summary.deposit} tone="green" testId="day-deposit" />
                <SumCard label="Çekim" value={daily.summary.withdrawal} tone="red" testId="day-withdrawal" />
                <SumCard label="Komisyon" value={daily.summary.commission} tone="yellow" testId="day-commission" />
                <SumCard label="Gider" value={daily.summary.expense} tone="red" testId="day-expense" />
                <SumCard label="Kar / Zarar" value={daily.summary.profit_loss} tone={daily.summary.profit_loss >= 0 ? "green" : "red"} testId="day-pnl" />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <MiniList title="İşlemler" empty="İşlem yok" data-testid="day-tx-list">
                  {daily.transactions.map((t) => (
                    <div key={t.id} className="flex justify-between text-xs font-data py-1.5 border-b border-border last:border-0">
                      <span className="text-neutral-400">{t.payment_method_id.slice(0,8)}</span>
                      <span className="text-[hsl(144_100%_55%)]">+{fmtTRY(t.deposit)}</span>
                      <span className="text-[hsl(345_100%_65%)]">-{fmtTRY(t.withdrawal)}</span>
                      <span className="text-white">{fmtTRY(t.net)}</span>
                    </div>
                  ))}
                </MiniList>
                <MiniList title="Giderler" empty="Gider yok" data-testid="day-expense-list">
                  {daily.expenses.map((e) => (
                    <div key={e.id} className="flex justify-between text-xs font-data py-1.5 border-b border-border last:border-0">
                      <span className="text-neutral-300">{e.description}</span>
                      <span className="text-[hsl(345_100%_65%)]">-{fmtTRY(e.amount)}</span>
                    </div>
                  ))}
                </MiniList>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SumCard({ label, value, tone, testId }) {
  const toneMap = {
    green: "text-[hsl(144_100%_55%)] glow-green",
    red: "text-[hsl(345_100%_65%)] glow-red",
    yellow: "text-[hsl(53_98%_60%)] glow-yellow",
  };
  return (
    <div className="border border-border bg-card rounded-sm p-4" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2">{label}</div>
      <div className={`font-data text-xl font-light tracking-tight ${toneMap[tone] || "text-white"}`}>{fmtTRY(value)}</div>
    </div>
  );
}

function MiniList({ title, empty, children, ...rest }) {
  const items = Array.isArray(children) ? children : [children].filter(Boolean);
  return (
    <div className="border border-border rounded-sm bg-card p-4" {...rest}>
      <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-3">{title}</div>
      {items.length === 0 && <div className="text-xs text-neutral-500 font-data py-4 text-center">{empty}</div>}
      {items.length > 0 && <div>{children}</div>}
    </div>
  );
}

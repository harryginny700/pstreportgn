import { useEffect, useState } from "react";
import { api, API } from "@/lib/api";
import { fmtTRY, fmtDateShort, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Download, FileText, ArrowRight, TrendingUp, TrendingDown, Percent, Wallet, Receipt, Landmark, Coins, ArrowLeftRight, Scale, PlusCircle, MinusCircle, Users, CreditCard, PiggyBank, Sparkles, Archive, Loader2, Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import TelegramPreviewDialog from "@/components/TelegramPreviewDialog";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

export default function Reports() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [monthly, setMonthly] = useState(null);
  const [dailyDate, setDailyDate] = useState(todayISO());
  const [daily, setDaily] = useState(null);
  const [rollingOver, setRollingOver] = useState(false);
  const navigate = useNavigate();

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

  useEffect(() => { loadMonthly(); /* eslint-disable-next-line */ }, [year, month]);
  useEffect(() => { loadDaily(); /* eslint-disable-next-line */ }, [dailyDate]);

  const downloadFile = async (url, filename) => {
    try {
      const r = await api.get(url, { responseType: "blob" });
      const blob = new Blob([r.data], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      toast.error("İndirme başarısız");
    }
  };

  const exportMonthly = () => downloadFile(`/export/monthly-report?year=${year}&month=${month}`, `rapor_${year}_${String(month).padStart(2,"0")}.csv`);
  const exportRange = () => {
    if (!monthly) return;
    downloadFile(`/export/transactions?date_from=${monthly.range.from}&date_to=${monthly.range.to}`, `islemler_${monthly.range.from}_${monthly.range.to}.csv`);
  };

  const doRollover = async () => {
    const confirmed = confirm(
      `${MONTHS[month - 1]} ${year} ayının devri alınacak.\n\n` +
      "• Bu ayın tüm raporları arşivlenecek (Devirler sayfasında görüntülenebilir)\n" +
      "• Toplam kasa bakiyeleri bir sonraki aya devredilecek (yeni açılış bakiyesi olur)\n" +
      "• Bu ayın işlem/gider/kredi/transfer kayıtları canlı listeden kaldırılıp arşive taşınır\n\n" +
      "Devam edilsin mi?"
    );
    if (!confirmed) return;
    setRollingOver(true);
    try {
      await api.post("/rollovers", { year, month });
      toast.success("Devir başarıyla alındı");
      loadMonthly();
      navigate("/devirler");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Devir hatası");
    } finally {
      setRollingOver(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="raporlar-page">
      <Tabs defaultValue="daily">
        <TabsList className="bg-secondary rounded-sm">
          <TabsTrigger value="daily" className="rounded-sm text-xs uppercase tracking-[0.2em]" data-testid="reports-tab-daily">Günlük</TabsTrigger>
          <TabsTrigger value="monthly" className="rounded-sm text-xs uppercase tracking-[0.2em]" data-testid="reports-tab-monthly">Aylık</TabsTrigger>
        </TabsList>

        {/* ============== DAILY ============== */}
        <TabsContent value="daily" className="mt-6 space-y-6">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Tarih</label>
                <Input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} className="w-52 bg-transparent border-border rounded-sm font-data h-9" data-testid="reports-daily-date" />
              </div>
              <TelegramSendButton date={dailyDate} />
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Rapor Tarihi</div>
              <div className="font-display text-2xl text-foreground mt-0.5" data-testid="daily-header-date">{fmtDateShort(dailyDate)}</div>
            </div>
          </div>

          {daily && <DailyReportGrid data={daily} />}
        </TabsContent>

        {/* ============== MONTHLY ============== */}
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
                    {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={exportRange} variant="outline" className="rounded-sm border-border hover:bg-secondary h-9 gap-2" data-testid="export-tx">
                <Download className="w-4 h-4" /> İşlemler CSV
              </Button>
              <Button onClick={exportMonthly} variant="outline" className="rounded-sm border-border hover:bg-secondary h-9 gap-2" data-testid="export-monthly">
                <FileText className="w-4 h-4" /> Rapor CSV
              </Button>
              <Button
                onClick={doRollover}
                disabled={rollingOver}
                className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95 disabled:opacity-60"
                data-testid="do-rollover"
              >
                {rollingOver ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                Aylık Devir Yap
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

              <div className="border border-border rounded-sm bg-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border">
                  <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Aylık Kırılım</div>
                  <h3 className="font-display text-lg text-white mt-0.5">Günlük Detay Tablosu</h3>
                </div>
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
                      <TableRow key={d.date} className="border-border hover:bg-white/[0.02] cursor-pointer" onClick={() => setDailyDate(d.date)}>
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

/* =====================================================
   MODERN DAILY REPORT GRID
   ===================================================== */

function DailyReportGrid({ data }) {
  const rows = data.payment_method_rows || [];
  const s = data.summary;

  // Left side totals (site members totals — nakit giriş)
  const totalDeposit = rows.reduce((a, r) => a + r.deposit, 0);
  const totalWithdrawal = rows.reduce((a, r) => a + r.withdrawal, 0);
  const totalCommission = rows.reduce((a, r) => a + r.commission, 0);
  const totalNet = rows.reduce((a, r) => a + r.net, 0);

  const memberDelta = totalDeposit - totalWithdrawal;
  const manuelDelta = (s.credit_added || 0) - (s.credit_paid || 0);
  const totalExpense = s.expense || 0;
  const profitLoss = s.profit_loss;

  return (
    <div className="flex flex-col gap-4" data-testid="daily-grid">
      {/* ============ Stat blocks (TOP) ============ */}
      <div className="space-y-3">
        {/* Members block (Site üyeleri) */}
        <StatBlock accent="primary" testId="stats-members" icon={Users} title="Site Üyeleri">
          <StatRow icon={TrendingUp} label="Site Üyeleri Yatırım" value={totalDeposit} tone="green" />
          <StatRow icon={TrendingDown} label="Site Üyeleri Çekim" value={totalWithdrawal} tone="red" />
          <StatRow icon={Percent} label="Toplam Ödenen Komisyon" value={totalCommission} tone="yellow" bold />
          <StatRow icon={PiggyBank} label="Site Üyeleri Günlük Kalan" value={totalNet} tone={totalNet >= 0 ? "green" : "red"} />
          <StatRow icon={Scale} label="Üyeler Yatırım-Çekim Farkı" value={memberDelta} tone={memberDelta >= 0 ? "green" : "red"} />
        </StatBlock>

        {/* Manual block */}
        <StatBlock accent="green" testId="stats-manual" icon={Coins} title="Manueller">
          <StatRow icon={PlusCircle} label="Eklenen Manuel Toplamı" value={s.credit_added || 0} tone="cyan" />
          <StatRow icon={MinusCircle} label="Ödenen Manuel Toplamı" value={s.credit_paid || 0} tone="cyan" />
          <StatRow icon={Scale} label="Manueller Fark" value={manuelDelta} tone={manuelDelta >= 0 ? "green" : "red"} bold />
        </StatBlock>

        {/* Site totals */}
        <StatBlock accent="primary" testId="stats-site-totals" icon={Wallet} title="Site Toplamları">
          <StatRow icon={TrendingUp} label="Toplam Site Yatırım" value={totalDeposit} tone="green" bold />
          <StatRow icon={TrendingDown} label="Toplam Site Çekim" value={totalWithdrawal} tone="red" bold />
          <StatRow icon={Receipt} label="Yapılan Ödemeler" value={totalExpense} tone="red" bold highlight />
        </StatBlock>

        {/* Transfers */}
        <div className="border border-border rounded-sm bg-card overflow-hidden" data-testid="stats-transfers">
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
            <ArrowLeftRight className="w-3.5 h-3.5 text-primary" />
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Kasalar Arası Transfer</div>
          </div>
          {data.transfers.length === 0 ? (
            <div className="p-4 text-center text-xs text-neutral-500 font-data">Transfer yok</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Giren</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Çıkan</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Tutar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.transfers.map((t) => (
                  <TableRow key={t.id} className="border-border hover:bg-white/[0.02]" data-testid={`transfer-row-${t.id}`}>
                    <TableCell className="text-xs text-[hsl(144_100%_55%)]">{t.to_name}</TableCell>
                    <TableCell className="text-xs text-[hsl(345_100%_65%)]">{t.from_name}</TableCell>
                    <TableCell className="text-right font-data text-xs text-white">{fmtTRY(t.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Expenses list (always shown) */}
        <div className="border border-border rounded-sm bg-card overflow-hidden" data-testid="stats-expenses">
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
            <Receipt className="w-3.5 h-3.5 text-[hsl(345_100%_65%)]" />
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Yapılan Ödemeler</div>
          </div>
          {data.expenses.length === 0 ? (
            <div className="p-4 text-center text-xs text-neutral-500 font-data">Ödeme yok</div>
          ) : (
            <div className="divide-y divide-border">
              {data.expenses.map((e) => (
                <div key={e.id} className="px-4 py-2 flex items-center justify-between text-xs" data-testid={`expense-row-${e.id}`}>
                  <div className="text-neutral-300 flex-1 min-w-0 truncate">{e.description}</div>
                  <div className="text-neutral-500 text-[10px] uppercase tracking-wider mx-3">{e.cash_register_name}</div>
                  <div className="font-data text-[hsl(345_100%_65%)]">{fmtTRY(e.amount)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom line P/L */}
        <div className={`border-2 rounded-sm p-5 ${profitLoss >= 0 ? "border-[hsl(144_100%_50%)]/50 bg-[hsl(144_100%_50%)]/[0.06]" : "border-[hsl(345_100%_60%)]/50 bg-[hsl(345_100%_60%)]/[0.06]"}`} data-testid="stats-pnl">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Sonuç</div>
            <Landmark className={`w-4 h-4 ${profitLoss >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`} />
          </div>
          <div className="flex items-baseline justify-between">
            <div className="font-display text-lg text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Toplam Kar / Zarar
            </div>
            <div className={`font-data text-3xl font-light tracking-tight ${profitLoss >= 0 ? "text-[hsl(144_100%_55%)] glow-green" : "text-[hsl(345_100%_65%)] glow-red"}`} data-testid="daily-profit-loss">
              {fmtTRY(profitLoss)}
            </div>
          </div>
        </div>
      </div>

      {/* ============ BOTTOM: Payment methods / Günlük Nakit Giriş table ============ */}
      <div className="border border-border rounded-sm bg-card overflow-x-auto" data-testid="daily-pm-table">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Ödeme Yöntemleri</div>
            <h3 className="font-display text-lg text-white mt-0.5">Günlük Nakit Giriş</h3>
          </div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-neutral-500 font-data">{rows.length} yöntem</div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent bg-secondary/40">
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-semibold">Yöntem</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-semibold text-right">Yatırım</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-semibold text-right">Çekim</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-semibold text-right">Komisyon</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-semibold text-right">Kalan Tutar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow className="border-border"><TableCell colSpan={5} className="text-center text-xs text-neutral-500 font-data py-8">Bu tarihte veri yok</TableCell></TableRow>
            )}
            {rows.map((r) => {
              const isEmpty = r.deposit === 0 && r.withdrawal === 0;
              return (
                <TableRow key={r.payment_method_id} className={`border-border ${isEmpty ? "opacity-40" : ""} hover:bg-white/[0.02]`} data-testid={`daily-pm-row-${r.name}`}>
                  <TableCell className="font-medium text-white text-sm">{r.name}</TableCell>
                  <TableCell className="text-right font-data text-sm text-[hsl(144_100%_55%)]">{r.deposit > 0 ? fmtTRY(r.deposit) : "—"}</TableCell>
                  <TableCell className="text-right font-data text-sm text-[hsl(345_100%_65%)]">{r.withdrawal > 0 ? fmtTRY(r.withdrawal) : "—"}</TableCell>
                  <TableCell className="text-right font-data text-sm text-[hsl(53_98%_60%)]">{r.commission > 0 ? fmtTRY(r.commission) : "—"}</TableCell>
                  <TableCell className={`text-right font-data text-sm ${r.net >= 0 ? "text-white" : "text-[hsl(345_100%_65%)]"}`}>{fmtTRY(r.net)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {/* Total row */}
        <div className="grid grid-cols-5 border-t-2 border-primary bg-primary/[0.06]">
          <div className="p-3 font-display text-sm text-primary uppercase tracking-widest">Nakit Giriş Toplamı</div>
          <div className="p-3 text-right font-data text-sm text-[hsl(144_100%_55%)] font-semibold" data-testid="daily-total-deposit">{fmtTRY(totalDeposit)}</div>
          <div className="p-3 text-right font-data text-sm text-[hsl(345_100%_65%)] font-semibold" data-testid="daily-total-withdrawal">{fmtTRY(totalWithdrawal)}</div>
          <div className="p-3 text-right font-data text-sm text-[hsl(53_98%_60%)] font-semibold" data-testid="daily-total-commission">{fmtTRY(totalCommission)}</div>
          <div className={`p-3 text-right font-data text-sm font-semibold ${totalNet >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`} data-testid="daily-total-net">{fmtTRY(totalNet)}</div>
        </div>
      </div>
    </div>
  );
}

function StatBlock({ children, accent = "primary", title, icon: Icon, testId }) {
  const accentBar = accent === "green"
    ? "border-l-[hsl(144_100%_50%)]"
    : accent === "yellow"
    ? "border-l-[hsl(53_98%_53%)]"
    : "border-l-primary";
  return (
    <div className={`border border-border border-l-4 ${accentBar} rounded-sm bg-card`} data-testid={testId}>
      {title && (
        <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
          {Icon && <Icon className="w-3.5 h-3.5 text-primary" />}
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{title}</div>
        </div>
      )}
      <div className="divide-y divide-border">
        {children}
      </div>
    </div>
  );
}

function StatRow({ label, value, tone, bold = false, highlight = false, icon: Icon }) {
  const toneMap = {
    green: "text-[hsl(144_100%_55%)]",
    red: "text-[hsl(345_100%_65%)]",
    yellow: "text-[hsl(53_98%_60%)]",
    cyan: "text-[hsl(186_100%_60%)]",
    white: "text-white",
  };
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 ${highlight ? "bg-[hsl(53_98%_53%)]/[0.05]" : ""}`}>
      <div className={`text-xs uppercase tracking-[0.15em] flex items-center gap-2 ${bold ? "text-white" : "text-neutral-400"}`}>
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <div className={`font-data ${bold ? "text-base font-semibold" : "text-sm"} ${toneMap[tone] || "text-white"}`}>
        {fmtTRY(value)}
      </div>
    </div>
  );
}

function TelegramSendButton({ date }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95 disabled:opacity-60"
        data-testid="telegram-send"
      >
        <Send className="w-4 h-4" />
        Telegram'a Gönder
      </Button>
      <TelegramPreviewDialog
        open={open}
        onOpenChange={setOpen}
        title={`Günlük Rapor (${date}) — Telegram Önizleme`}
        previewUrl={`/reports/daily/telegram-preview?date=${date}`}
        sendUrl={`/reports/daily/send-telegram?date=${date}`}
      />
    </>
  );
}


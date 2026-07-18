import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY, monthStartISO, monthEndISO } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { TrendingUp, TrendingDown, Wallet, Download, BarChart3, Globe, Store, Layers, Loader2 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export default function AdminReport() {
  const [dateFrom, setDateFrom] = useState(monthStartISO());
  const [dateTo, setDateTo] = useState(monthEndISO());
  const [siteType, setSiteType] = useState("all");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { date_from: dateFrom, date_to: dateTo };
      if (siteType !== "all") params.site_type = siteType;
      const r = await api.get("/admin/report", { params });
      setData(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Rapor yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, siteType]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = async () => {
    try {
      const params = { date_from: dateFrom, date_to: dateTo };
      if (siteType !== "all") params.site_type = siteType;
      const r = await api.get("/admin/report/export.csv", { params, responseType: "blob" });
      const blob = new Blob([r.data], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `admin_rapor_${dateFrom}_${dateTo}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      toast.error("CSV indirilemedi");
    }
  };

  const chartData = useMemo(() => {
    if (!data?.daily) return [];
    return data.daily.map((d) => ({ date: d.date.slice(5), Gelir: d.income, Gider: d.expense, Net: d.net }));
  }, [data]);

  const totals = data?.totals || { income: 0, expense: 0, net: 0 };
  const isProfit = totals.net >= 0;

  return (
    <div className="space-y-6" data-testid="admin-report-page">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="w-5 h-5 text-primary" />
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Admin</div>
          <h2 className="font-display text-xl text-foreground">Gelir / Gider Raporu</h2>
        </div>
      </div>

      {/* Filters */}
      <div className="border border-border rounded-sm bg-card p-4 md:p-5">
        <div className="flex flex-wrap items-end gap-3 justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Başlangıç</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40 bg-transparent border-border rounded-sm font-data h-9"
                data-testid="ar-date-from"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Bitiş</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40 bg-transparent border-border rounded-sm font-data h-9"
                data-testid="ar-date-to"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Site Tipi</label>
              <Select value={siteType} onValueChange={setSiteType}>
                <SelectTrigger className="w-40 h-9 rounded-sm bg-transparent border-border text-xs" data-testid="ar-filter-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="ar-type-all">Tümü</SelectItem>
                  <SelectItem value="online" data-testid="ar-type-online">
                    <span className="inline-flex items-center gap-1"><Globe className="w-3 h-3" /> Online</span>
                  </SelectItem>
                  <SelectItem value="sokak" data-testid="ar-type-sokak">
                    <span className="inline-flex items-center gap-1"><Store className="w-3 h-3" /> Sokak</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={exportCsv}
              variant="outline"
              className="rounded-sm border-border h-9 gap-2"
              data-testid="ar-export-csv"
            >
              <Download className="w-4 h-4" /> CSV
            </Button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-6" data-testid="ar-loading">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Rapor hesaplanıyor...
        </div>
      )}

      {!loading && data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="border border-border rounded-sm bg-card p-4" data-testid="ar-kpi-income">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-3.5 h-3.5 text-[hsl(144_100%_55%)]" />
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Toplam Gelir</div>
              </div>
              <div className="text-2xl font-light font-data tracking-tight text-[hsl(144_100%_55%)]">
                {fmtTRY(totals.income)}
              </div>
            </div>
            <div className="border border-border rounded-sm bg-card p-4" data-testid="ar-kpi-expense">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="w-3.5 h-3.5 text-[hsl(345_100%_65%)]" />
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Toplam Gider</div>
              </div>
              <div className="text-2xl font-light font-data tracking-tight text-[hsl(345_100%_65%)]">
                {fmtTRY(totals.expense)}
              </div>
            </div>
            <div className="border border-border rounded-sm bg-card p-4" data-testid="ar-kpi-net">
              <div className="flex items-center gap-2 mb-2">
                <Layers className="w-3.5 h-3.5 text-primary" />
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Net Kâr</div>
              </div>
              <div className={`text-2xl font-light font-data tracking-tight ${isProfit ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`}>
                {fmtTRY(totals.net)}
              </div>
            </div>
          </div>

          {/* Daily bar chart */}
          <div className="border border-border rounded-sm bg-card p-4 md:p-5" data-testid="ar-chart">
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-3">Günlük Trend</div>
            {chartData.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-10">Bu dönemde veri yok</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                    formatter={(v) => fmtTRY(v)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Gelir" fill="hsl(144 100% 45%)" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Gider" fill="hsl(345 100% 60%)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Two-column breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Income by partner */}
            <div className="border border-border rounded-sm bg-card" data-testid="ar-income-by-partner">
              <div className="p-4 border-b border-border flex items-center gap-2">
                <Wallet className="w-4 h-4 text-[hsl(144_100%_55%)]" />
                <div className="text-sm font-medium text-foreground">Gelir — Ortak Kasa Bazlı</div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Ortak Kasa</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Tutar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.income_by_partner || []).map((r) => (
                    <TableRow key={r.partner_name} className="border-border">
                      <TableCell className="text-sm text-foreground">{r.partner_name}</TableCell>
                      <TableCell className="text-right font-data text-sm text-[hsl(144_100%_55%)]">{fmtTRY(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Expenses by partner */}
            <div className="border border-border rounded-sm bg-card" data-testid="ar-expenses-by-partner">
              <div className="p-4 border-b border-border flex items-center gap-2">
                <Wallet className="w-4 h-4 text-[hsl(345_100%_65%)]" />
                <div className="text-sm font-medium text-foreground">Gider — Ortak Kasa Bazlı</div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Ortak Kasa</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Tutar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.expenses_by_partner || []).map((r) => (
                    <TableRow key={r.partner_name} className="border-border">
                      <TableCell className="text-sm text-foreground">{r.partner_name}</TableCell>
                      <TableCell className="text-right font-data text-sm text-[hsl(345_100%_65%)]">{fmtTRY(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Expenses by category */}
            <div className="border border-border rounded-sm bg-card" data-testid="ar-expenses-by-category">
              <div className="p-4 border-b border-border flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-[hsl(345_100%_65%)]" />
                <div className="text-sm font-medium text-foreground">Gider — Kategori Bazlı</div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Kategori</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Tutar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.expenses_by_category || []).length === 0 && (
                    <TableRow className="border-border">
                      <TableCell colSpan={2} className="text-center text-xs text-muted-foreground py-6">Kategori kaydı yok</TableCell>
                    </TableRow>
                  )}
                  {(data.expenses_by_category || []).map((r) => (
                    <TableRow key={r.category} className="border-border">
                      <TableCell className="text-sm text-foreground">{r.category}</TableCell>
                      <TableCell className="text-right font-data text-sm text-[hsl(345_100%_65%)]">{fmtTRY(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Site breakdown */}
            <div className="border border-border rounded-sm bg-card" data-testid="ar-site-breakdown">
              <div className="p-4 border-b border-border flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[hsl(144_100%_55%)]" />
                <div className="text-sm font-medium text-foreground">Site Bazlı Gelir</div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Site</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Tip</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Gelir</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.site_breakdown || []).length === 0 && (
                    <TableRow className="border-border">
                      <TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-6">Bu dönemde site geliri yok</TableCell>
                    </TableRow>
                  )}
                  {(data.site_breakdown || []).map((r) => (
                    <TableRow key={r.site_id} className="border-border">
                      <TableCell className="text-sm text-foreground">{r.site_name}</TableCell>
                      <TableCell className="text-xs">
                        {r.type === "online" ? (
                          <span className="inline-flex items-center gap-1 text-[hsl(200_100%_65%)]">
                            <Globe className="w-3 h-3" /> Online
                          </span>
                        ) : r.type === "sokak" ? (
                          <span className="inline-flex items-center gap-1 text-[hsl(45_100%_55%)]">
                            <Store className="w-3 h-3" /> Sokak
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-data text-sm text-[hsl(144_100%_55%)]">{fmtTRY(r.income)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { HandCoins, Landmark, Check, AlertCircle } from "lucide-react";

export default function AdminSiteCreditsSummary() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/admin/site-credits-summary");
        setRows(r.data || []);
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Yüklenemedi");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totals = useMemo(() => {
    let credit = 0, debt = 0, paid = 0, remaining = 0;
    rows.forEach(r => { credit += r.total_credit; debt += r.total_debt; paid += r.total_paid; remaining += r.total_remaining; });
    return { credit, debt, paid, remaining };
  }, [rows]);

  return (
    <div className="space-y-6" data-testid="admin-site-credits-summary-page">
      {/* Totals */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card icon={HandCoins} label="Toplam Verilen Kredi" value={fmtTRY(totals.credit)} />
        <Card icon={Landmark} label="Toplam Oluşan Borç" value={fmtTRY(totals.debt)} />
        <Card icon={Check} label="Toplam Alınan Ödeme" value={fmtTRY(totals.paid)} tone="success" />
        <Card icon={AlertCircle} label="Toplam Bekleyen" value={fmtTRY(totals.remaining)} tone={totals.remaining > 0 ? "warning" : "muted"} testid="scs-total-remaining" />
      </div>

      {/* Table */}
      <div className="border border-border rounded-sm bg-card overflow-x-auto">
        <div className="px-5 py-3 border-b border-border">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Site Bazında</div>
          <h3 className="font-display text-lg text-foreground">Sitelere Verilen Krediler — Ödeme Durumu</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Site</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">Kredi Sayısı</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">Verilen Kredi</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">Toplam Borç</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">Alınan Ödeme</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">Bekleyen Ödeme</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-center">Ödenmemiş / Kısmi / Ödendi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow className="border-border"><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-6">Yükleniyor...</TableCell></TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow className="border-border"><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">Kayıt yok</TableCell></TableRow>
            )}
            {!loading && rows.map(r => (
              <TableRow key={r.site_id} className="border-border" data-testid={`scs-row-${r.site_id}`}>
                <TableCell className="text-sm text-foreground font-medium">{r.site_name}</TableCell>
                <TableCell className="text-right font-data text-xs text-muted-foreground">{r.credit_count}</TableCell>
                <TableCell className="text-right font-data text-sm text-foreground">{fmtTRY(r.total_credit)}</TableCell>
                <TableCell className="text-right font-data text-sm text-foreground">{fmtTRY(r.total_debt)}</TableCell>
                <TableCell className="text-right font-data text-sm text-[hsl(144_100%_55%)]">{fmtTRY(r.total_paid)}</TableCell>
                <TableCell className={`text-right font-data text-sm font-medium ${r.total_remaining > 0 ? "text-[hsl(45_100%_55%)]" : "text-muted-foreground"}`}>{fmtTRY(r.total_remaining)}</TableCell>
                <TableCell className="text-center text-xs font-data">
                  <span className="text-[hsl(45_100%_55%)]">{r.unpaid_count}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className="text-[hsl(200_100%_65%)]">{r.partial_count}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className="text-[hsl(144_100%_55%)]">{r.paid_count}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Card({ icon: Icon, label, value, tone, testid }) {
  const toneCls = tone === "warning" ? "text-[hsl(45_100%_55%)]"
    : tone === "success" ? "text-[hsl(144_100%_55%)]"
    : tone === "muted" ? "text-muted-foreground"
    : "text-foreground";
  return (
    <div className="border border-border rounded-sm bg-card p-4" data-testid={testid}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5 text-primary" />
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
      </div>
      <div className={`font-data text-xl ${toneCls}`}>{value}</div>
    </div>
  );
}

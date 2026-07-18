import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { HandCoins, Landmark, Check, Percent } from "lucide-react";

/**
 * Site panel: Alınan Krediler
 * Read-only list of credits Playspintech has assigned to this site.
 * Uses `/api/site-credits/mine` (backend also serves admin viewing a site via ?site_id).
 */
export default function ReceivedCredits() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/site-credits/mine");
      setRows(r.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    let creditTotal = 0, debtTotal = 0, paidTotal = 0, remainingTotal = 0;
    rows.forEach(r => {
      creditTotal += r.amount || 0;
      debtTotal += r.debt || 0;
      paidTotal += r.paid_amount || 0;
      remainingTotal += r.remaining_debt || 0;
    });
    return { creditTotal, debtTotal, paidTotal, remainingTotal };
  }, [rows]);

  return (
    <div className="space-y-6" data-testid="received-credits-page">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card icon={HandCoins} label="Toplam Alınan Kredi" value={fmtTRY(totals.creditTotal)} />
        <Card icon={Percent} label="Toplam Borç" value={fmtTRY(totals.debtTotal)} />
        <Card icon={Check} label="Ödenmiş" value={fmtTRY(totals.paidTotal)} tone="success" />
        <Card icon={Landmark} label="Kalan Borç" value={fmtTRY(totals.remainingTotal)} tone={totals.remainingTotal > 0 ? "warning" : "muted"} testid="rc-remaining-total" />
      </div>

      {/* Table */}
      <div className="border border-border rounded-sm bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Tarih</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">Kredi Miktarı</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">%</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">Borç</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">Ödenmiş</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">Kalan</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Durum</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Not</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow className="border-border"><TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-6">Yükleniyor...</TableCell></TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow className="border-border"><TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-8">Kayıt yok — bu site için henüz kredi tanımlanmamış.</TableCell></TableRow>
            )}
            {!loading && rows.map(r => {
              const isPaid = r.status === "paid";
              const isPartial = r.status === "partial" || ((r.paid_amount || 0) > 0 && !isPaid);
              return (
                <TableRow key={r.id} className="border-border" data-testid={`rc-row-${r.id}`}>
                  <TableCell className="font-data text-xs text-foreground">{r.date}</TableCell>
                  <TableCell className="text-right font-data text-sm text-foreground">{fmtTRY(r.amount)}</TableCell>
                  <TableCell className="text-right font-data text-xs text-muted-foreground">%{r.commission_pct}</TableCell>
                  <TableCell className="text-right font-data text-sm text-foreground">{fmtTRY(r.debt)}</TableCell>
                  <TableCell className="text-right font-data text-xs text-[hsl(144_100%_55%)]">{fmtTRY(r.paid_amount || 0)}</TableCell>
                  <TableCell className={`text-right font-data text-sm font-medium ${isPaid ? "text-muted-foreground" : "text-[hsl(45_100%_55%)]"}`}>{fmtTRY(r.remaining_debt || 0)}</TableCell>
                  <TableCell>
                    {isPaid ? (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded-sm border border-[hsl(144_100%_45%)] text-[hsl(144_100%_55%)]" data-testid={`rc-status-${r.id}`}>
                        <Check className="w-3 h-3" /> Ödendi
                      </span>
                    ) : isPartial ? (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded-sm border border-[hsl(200_100%_55%)] text-[hsl(200_100%_65%)]" data-testid={`rc-status-${r.id}`}>Kısmi</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded-sm border border-[hsl(45_100%_55%)] text-[hsl(45_100%_55%)]" data-testid={`rc-status-${r.id}`}>Ödenmedi</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">{r.note || "—"}</TableCell>
                </TableRow>
              );
            })}
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

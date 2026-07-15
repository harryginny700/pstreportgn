import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY, todayISO } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Save, Calculator } from "lucide-react";

export default function DailyEntry() {
  const [date, setDate] = useState(todayISO());
  const [methods, setMethods] = useState([]);
  const [entries, setEntries] = useState({}); // {method_id: {deposit, withdrawal}}
  const [loading, setLoading] = useState(false);

  const loadForDate = async (d) => {
    setLoading(true);
    try {
      const [m, t] = await Promise.all([
        api.get("/payment-methods"),
        api.get("/transactions", { params: { date_from: d, date_to: d } }),
      ]);
      setMethods(m.data);
      const map = {};
      for (const pm of m.data) {
        map[pm.id] = { deposit: 0, withdrawal: 0 };
      }
      for (const tx of t.data) {
        map[tx.payment_method_id] = { deposit: tx.deposit, withdrawal: tx.withdrawal };
      }
      setEntries(map);
    } catch (e) {
      toast.error("Yüklenemedi");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadForDate(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const setVal = (pmId, field, v) => {
    setEntries((prev) => ({
      ...prev,
      [pmId]: { ...(prev[pmId] || { deposit: 0, withdrawal: 0 }), [field]: Number(v) || 0 },
    }));
  };

  const rows = useMemo(() => {
    return methods.map((m) => {
      const e = entries[m.id] || { deposit: 0, withdrawal: 0 };
      const commission = (e.deposit * m.deposit_commission_pct) / 100 + (e.withdrawal * m.withdrawal_commission_pct) / 100;
      const net = e.deposit - e.withdrawal - commission;
      return { ...m, deposit: e.deposit, withdrawal: e.withdrawal, commission, net };
    });
  }, [methods, entries]);

  const totals = useMemo(() => {
    return rows.reduce(
      (a, r) => ({
        deposit: a.deposit + r.deposit,
        withdrawal: a.withdrawal + r.withdrawal,
        commission: a.commission + r.commission,
        net: a.net + r.net,
      }),
      { deposit: 0, withdrawal: 0, commission: 0, net: 0 }
    );
  }, [rows]);

  const save = async () => {
    const payload = {
      date,
      entries: methods.map((m) => ({
        payment_method_id: m.id,
        deposit: entries[m.id]?.deposit || 0,
        withdrawal: entries[m.id]?.withdrawal || 0,
      })),
    };
    try {
      const r = await api.post("/transactions/bulk", payload);
      toast.success(`${r.data.saved} işlem kaydedildi (${date})`);
    } catch (e) {
      toast.error("Kayıt hatası");
    }
  };

  return (
    <div className="space-y-6" data-testid="daily-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Tarih</label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-52 bg-transparent border-border rounded-sm font-data"
            data-testid="daily-date"
          />
        </div>
        <Button
          onClick={save}
          className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 font-medium active:scale-95 gap-2"
          data-testid="daily-save"
        >
          <Save className="w-4 h-4" />
          Günü Kaydet
        </Button>
      </div>

      <div className="border border-border rounded-sm bg-card overflow-hidden" data-testid="daily-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-medium">Ödeme Yöntemi</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-medium text-center w-20">Kom. Y/Ç %</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-medium text-right">Yatırım</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-medium text-right">Çekim</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-medium text-right">Komisyon</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-medium text-right">Kalan (Net)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="border-border hover:bg-white/[0.02]" data-testid={`daily-row-${r.id}`}>
                <TableCell className="font-medium text-white text-sm">{r.name}</TableCell>
                <TableCell className="text-center text-xs font-data text-neutral-400">
                  {r.deposit_commission_pct}/{r.withdrawal_commission_pct}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    step="0.01"
                    value={entries[r.id]?.deposit || ""}
                    onChange={(e) => setVal(r.id, "deposit", e.target.value)}
                    placeholder="0"
                    className="w-32 ml-auto text-right font-data bg-transparent border-border rounded-sm h-8"
                    data-testid={`daily-deposit-${r.id}`}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    step="0.01"
                    value={entries[r.id]?.withdrawal || ""}
                    onChange={(e) => setVal(r.id, "withdrawal", e.target.value)}
                    placeholder="0"
                    className="w-32 ml-auto text-right font-data bg-transparent border-border rounded-sm h-8"
                    data-testid={`daily-withdrawal-${r.id}`}
                  />
                </TableCell>
                <TableCell className="text-right font-data text-sm text-[hsl(53_98%_60%)]" data-testid={`daily-commission-${r.id}`}>
                  {fmtTRY(r.commission)}
                </TableCell>
                <TableCell className={`text-right font-data text-sm ${r.net >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`} data-testid={`daily-net-${r.id}`}>
                  {fmtTRY(r.net)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="grid grid-cols-6 border-t-2 border-primary bg-secondary/40">
          <div className="p-3 col-span-2 text-[10px] uppercase tracking-[0.2em] text-white font-medium flex items-center gap-2">
            <Calculator className="w-3 h-3" />
            Günlük Toplam
          </div>
          <div className="p-3 text-right font-data text-sm text-[hsl(144_100%_55%)]" data-testid="daily-total-deposit">{fmtTRY(totals.deposit)}</div>
          <div className="p-3 text-right font-data text-sm text-[hsl(345_100%_65%)]" data-testid="daily-total-withdrawal">{fmtTRY(totals.withdrawal)}</div>
          <div className="p-3 text-right font-data text-sm text-[hsl(53_98%_60%)]" data-testid="daily-total-commission">{fmtTRY(totals.commission)}</div>
          <div className={`p-3 text-right font-data text-sm ${totals.net >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`} data-testid="daily-total-net">{fmtTRY(totals.net)}</div>
        </div>
      </div>

      {loading && <div className="text-xs text-neutral-500 font-data">Yükleniyor...</div>}
    </div>
  );
}

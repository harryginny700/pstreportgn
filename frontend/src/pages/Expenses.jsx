import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY, todayISO, fmtDateShort } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

export default function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [kasalar, setKasalar] = useState([]);
  const [form, setForm] = useState({ date: todayISO(), description: "", amount: 0, cash_register_id: "", note: "" });

  const load = useCallback(async () => {
    const [e, k] = await Promise.all([api.get("/expenses"), api.get("/cash-registers")]);
    setExpenses(e.data);
    setKasalar(k.data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.description) return toast.error("Ödeme yeri girin");
    if (!form.cash_register_id) return toast.error("Kasa seçin");
    if (!form.amount || Number(form.amount) <= 0) return toast.error("Tutar girin");
    try {
      await api.post("/expenses", { ...form, amount: Number(form.amount) });
      toast.success("Gider kaydedildi");
      setForm({ date: todayISO(), description: "", amount: 0, cash_register_id: "", note: "" });
      load();
    } catch (e) { toast.error("Kayıt hatası"); }
  };

  const del = async (id) => {
    if (!confirm("Silinsin mi?")) return;
    await api.delete(`/expenses/${id}`);
    toast.success("Silindi");
    load();
  };

  const kasaMap = Object.fromEntries(kasalar.map((k) => [k.id, k.name]));
  const total = expenses.reduce((a, e) => a + e.amount, 0);

  return (
    <div className="space-y-6" data-testid="giderler-page">
      <div className="border border-border rounded-sm bg-card p-6">
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2">Toplam Gider (Tüm Zamanlar)</div>
        <div className="font-data text-4xl font-light tracking-tight text-[hsl(345_100%_65%)] glow-red" data-testid="expenses-total">
          {fmtTRY(total)}
        </div>
      </div>

      <div className="border border-border rounded-sm bg-card p-4 md:p-5">
        <h3 className="font-display text-lg text-foreground mb-4">Yeni Gider / Ödeme</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Tarih</label>
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="bg-transparent border-border rounded-sm font-data h-9" data-testid="expense-date" />
          </div>
          <div className="md:col-span-2">
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Ödeme Yeri / Açıklama</label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="bg-transparent border-border rounded-sm h-9" data-testid="expense-description" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Tutar</label>
            <Input type="number" step="0.01" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="bg-transparent border-border rounded-sm h-9 font-data text-right" data-testid="expense-amount" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Kasa</label>
            <Select value={form.cash_register_id} onValueChange={(v) => setForm({ ...form, cash_register_id: v })}>
              <SelectTrigger className="bg-transparent border-border rounded-sm h-9" data-testid="expense-kasa"><SelectValue placeholder="Seçin" /></SelectTrigger>
              <SelectContent>
                {kasalar.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={submit} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 font-medium h-9 gap-1 active:scale-95" data-testid="expense-submit">
            <Plus className="w-4 h-4" /> Ekle
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-sm bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Tarih</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Ödeme Yeri</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Kasa</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Tutar</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.length === 0 && (
              <TableRow className="border-border"><TableCell colSpan={5} className="text-center text-xs text-neutral-500 font-data py-8">Kayıt yok</TableCell></TableRow>
            )}
            {expenses.map((e) => (
              <TableRow key={e.id} className="border-border hover:bg-white/[0.02]" data-testid={`expense-row-${e.id}`}>
                <TableCell className="font-data text-xs text-neutral-300">{fmtDateShort(e.date)}</TableCell>
                <TableCell className="text-sm text-white">{e.description}</TableCell>
                <TableCell className="text-sm text-neutral-400">{kasaMap[e.cash_register_id] || "-"}</TableCell>
                <TableCell className="text-right font-data text-sm text-[hsl(345_100%_65%)]">{fmtTRY(e.amount)}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => del(e.id)} className="h-7 w-7 rounded-sm text-neutral-500 hover:text-red-400" data-testid={`expense-delete-${e.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

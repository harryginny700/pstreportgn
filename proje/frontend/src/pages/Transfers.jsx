import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY, todayISO, fmtDateShort } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowRight, Plus, Trash2 } from "lucide-react";

export default function Transfers() {
  const [kasalar, setKasalar] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [form, setForm] = useState({ date: todayISO(), from_cash_register_id: "", to_cash_register_id: "", amount: 0, note: "" });

  const load = async () => {
    const [k, t] = await Promise.all([api.get("/cash-registers"), api.get("/transfers")]);
    setKasalar(k.data);
    setTransfers(t.data);
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.from_cash_register_id || !form.to_cash_register_id) return toast.error("Kaynak ve hedef kasa seçin");
    if (form.from_cash_register_id === form.to_cash_register_id) return toast.error("Aynı kasa seçilemez");
    if (!form.amount || Number(form.amount) <= 0) return toast.error("Tutar girin");
    try {
      await api.post("/transfers", { ...form, amount: Number(form.amount) });
      toast.success("Transfer kaydedildi");
      setForm({ date: todayISO(), from_cash_register_id: "", to_cash_register_id: "", amount: 0, note: "" });
      load();
    } catch (e) { toast.error("Kayıt hatası"); }
  };

  const del = async (id) => {
    if (!confirm("Silinsin mi?")) return;
    await api.delete(`/transfers/${id}`);
    load();
  };

  const kasaMap = Object.fromEntries(kasalar.map((k) => [k.id, k.name]));

  return (
    <div className="space-y-6" data-testid="transferler-page">
      <div className="border border-border rounded-sm bg-card p-4 md:p-5">
        <h3 className="font-display text-lg text-foreground mb-4">Kasalar Arası Transfer</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Tarih</label>
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="bg-transparent border-border rounded-sm font-data h-9" data-testid="transfer-date" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Kaynak Kasa</label>
            <Select value={form.from_cash_register_id} onValueChange={(v) => setForm({ ...form, from_cash_register_id: v })}>
              <SelectTrigger className="bg-transparent border-border rounded-sm h-9" data-testid="transfer-from"><SelectValue placeholder="Seçin" /></SelectTrigger>
              <SelectContent>
                {kasalar.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Hedef Kasa</label>
            <Select value={form.to_cash_register_id} onValueChange={(v) => setForm({ ...form, to_cash_register_id: v })}>
              <SelectTrigger className="bg-transparent border-border rounded-sm h-9" data-testid="transfer-to"><SelectValue placeholder="Seçin" /></SelectTrigger>
              <SelectContent>
                {kasalar.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Tutar</label>
            <Input type="number" step="0.01" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="bg-transparent border-border rounded-sm h-9 font-data text-right" data-testid="transfer-amount" />
          </div>
          <div className="md:col-span-1">
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Not</label>
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="bg-transparent border-border rounded-sm h-9" data-testid="transfer-note" />
          </div>
          <Button onClick={submit} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 font-medium h-9 gap-1 active:scale-95" data-testid="transfer-submit">
            <Plus className="w-4 h-4" /> Ekle
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-sm bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Tarih</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Kaynak</TableHead>
              <TableHead className="w-10"></TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Hedef</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Tutar</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Not</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transfers.length === 0 && (
              <TableRow className="border-border"><TableCell colSpan={7} className="text-center text-xs text-neutral-500 font-data py-8">Kayıt yok</TableCell></TableRow>
            )}
            {transfers.map((t) => (
              <TableRow key={t.id} className="border-border hover:bg-white/[0.02]" data-testid={`transfer-row-${t.id}`}>
                <TableCell className="font-data text-xs text-neutral-300">{fmtDateShort(t.date)}</TableCell>
                <TableCell className="text-sm text-[hsl(345_100%_65%)]">{kasaMap[t.from_cash_register_id] || "?"}</TableCell>
                <TableCell><ArrowRight className="w-3.5 h-3.5 text-neutral-500" /></TableCell>
                <TableCell className="text-sm text-[hsl(144_100%_55%)]">{kasaMap[t.to_cash_register_id] || "?"}</TableCell>
                <TableCell className="text-right font-data text-sm text-white">{fmtTRY(t.amount)}</TableCell>
                <TableCell className="text-xs text-neutral-500">{t.note || "-"}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => del(t.id)} className="h-7 w-7 rounded-sm text-neutral-500 hover:text-red-400" data-testid={`transfer-delete-${t.id}`}>
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

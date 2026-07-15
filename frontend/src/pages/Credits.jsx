import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY, todayISO, fmtDateShort } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

export default function Credits() {
  const [debtors, setDebtors] = useState([]);
  const [kasalar, setKasalar] = useState([]);
  const [credits, setCredits] = useState([]);
  const [form, setForm] = useState({ date: todayISO(), debtor_id: "", added: 0, paid: 0, member_name: "", cash_register_id: "", note: "" });

  const load = async () => {
    const [d, k, c] = await Promise.all([
      api.get("/debtors"),
      api.get("/cash-registers"),
      api.get("/credits"),
    ]);
    setDebtors(d.data);
    setKasalar(k.data);
    setCredits(c.data);
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.debtor_id) return toast.error("Kredici seçin");
    if (form.added <= 0 && form.paid <= 0) return toast.error("Eklenen veya ödenen tutar girin");
    try {
      await api.post("/credits", {
        ...form,
        added: Number(form.added) || 0,
        paid: Number(form.paid) || 0,
      });
      toast.success("Kredi hareketi kaydedildi");
      setForm({ date: todayISO(), debtor_id: "", added: 0, paid: 0, member_name: "", cash_register_id: "", note: "" });
      load();
    } catch (e) {
      toast.error("Kayıt hatası");
    }
  };

  const del = async (id) => {
    if (!confirm("Silinsin mi?")) return;
    await api.delete(`/credits/${id}`);
    toast.success("Silindi");
    load();
  };

  const balances = debtors.map((d) => {
    const added = credits.filter((c) => c.debtor_id === d.id).reduce((a, c) => a + c.added, 0);
    const paid = credits.filter((c) => c.debtor_id === d.id).reduce((a, c) => a + c.paid, 0);
    return { ...d, added, paid, balance: d.initial_balance + added - paid };
  });

  const debtorMap = Object.fromEntries(debtors.map((d) => [d.id, d.name]));
  const kasaMap = Object.fromEntries(kasalar.map((k) => [k.id, k.name]));

  return (
    <div className="space-y-6" data-testid="krediler-page">
      {/* Debtor balances */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {balances.map((d) => (
          <div key={d.id} className="border border-border bg-card p-5 rounded-sm" data-testid={`debtor-card-${d.name}`}>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2">{d.name}</div>
            <div className={`font-data text-2xl font-light tracking-tight ${d.balance >= 0 ? "text-white" : "text-[hsl(144_100%_55%)]"}`}>
              {fmtTRY(d.balance)}
            </div>
            <div className="mt-2 text-[10px] font-data text-neutral-500">
              +{fmtTRY(d.added)} / -{fmtTRY(d.paid)}
            </div>
          </div>
        ))}
      </div>

      {/* Add form */}
      <div className="border border-border rounded-sm bg-card p-5">
        <h3 className="font-display text-lg text-white mb-4">Kredi Hareketi Ekle</h3>
        <div className="grid grid-cols-2 md:grid-cols-7 gap-3 items-end">
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Tarih</label>
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="bg-transparent border-border rounded-sm font-data h-9" data-testid="credit-date" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Kredici</label>
            <Select value={form.debtor_id} onValueChange={(v) => setForm({ ...form, debtor_id: v })}>
              <SelectTrigger className="bg-transparent border-border rounded-sm h-9" data-testid="credit-debtor"><SelectValue placeholder="Seçin" /></SelectTrigger>
              <SelectContent>
                {debtors.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Eklenen</label>
            <Input type="number" step="0.01" value={form.added || ""} onChange={(e) => setForm({ ...form, added: e.target.value })} className="bg-transparent border-border rounded-sm font-data h-9 text-right" data-testid="credit-added" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Ödenen</label>
            <Input type="number" step="0.01" value={form.paid || ""} onChange={(e) => setForm({ ...form, paid: e.target.value })} className="bg-transparent border-border rounded-sm font-data h-9 text-right" data-testid="credit-paid" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Üye</label>
            <Input value={form.member_name} onChange={(e) => setForm({ ...form, member_name: e.target.value })} className="bg-transparent border-border rounded-sm h-9" data-testid="credit-member" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Kasa</label>
            <Select value={form.cash_register_id} onValueChange={(v) => setForm({ ...form, cash_register_id: v })}>
              <SelectTrigger className="bg-transparent border-border rounded-sm h-9" data-testid="credit-kasa"><SelectValue placeholder="Seçin" /></SelectTrigger>
              <SelectContent>
                {kasalar.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={submit} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 font-medium h-9 gap-1 active:scale-95" data-testid="credit-submit">
            <Plus className="w-4 h-4" /> Ekle
          </Button>
        </div>
      </div>

      {/* History */}
      <div className="border border-border rounded-sm bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Tarih</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Kredici</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Üye</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Kasa</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Eklenen</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Ödenen</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {credits.length === 0 && (
              <TableRow className="border-border"><TableCell colSpan={7} className="text-center text-xs text-neutral-500 font-data py-8">Kayıt yok</TableCell></TableRow>
            )}
            {credits.map((c) => (
              <TableRow key={c.id} className="border-border hover:bg-white/[0.02]" data-testid={`credit-row-${c.id}`}>
                <TableCell className="font-data text-xs text-neutral-300">{fmtDateShort(c.date)}</TableCell>
                <TableCell className="text-sm text-white">{debtorMap[c.debtor_id] || "?"}</TableCell>
                <TableCell className="text-sm text-neutral-400">{c.member_name || "-"}</TableCell>
                <TableCell className="text-sm text-neutral-400">{kasaMap[c.cash_register_id] || "-"}</TableCell>
                <TableCell className="text-right font-data text-sm text-[hsl(53_98%_60%)]">{c.added > 0 ? fmtTRY(c.added) : "-"}</TableCell>
                <TableCell className="text-right font-data text-sm text-[hsl(144_100%_55%)]">{c.paid > 0 ? fmtTRY(c.paid) : "-"}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => del(c.id)} className="h-7 w-7 rounded-sm text-neutral-500 hover:text-red-400" data-testid={`credit-delete-${c.id}`}>
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

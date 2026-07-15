import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, Save } from "lucide-react";

export default function Settings() {
  const [methods, setMethods] = useState([]);
  const [kasalar, setKasalar] = useState([]);
  const [debtors, setDebtors] = useState([]);
  const [editing, setEditing] = useState({}); // pm.id -> { deposit_commission_pct, withdrawal_commission_pct }

  const load = async () => {
    const [m, k, d] = await Promise.all([
      api.get("/payment-methods"),
      api.get("/cash-registers"),
      api.get("/debtors"),
    ]);
    setMethods(m.data);
    setKasalar(k.data);
    setDebtors(d.data);
  };
  useEffect(() => { load(); }, []);

  const setEditField = (id, field, val) => {
    setEditing((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: val } }));
  };

  const savePm = async (m) => {
    const edit = editing[m.id] || {};
    const payload = {
      name: edit.name ?? m.name,
      cash_register_id: edit.cash_register_id ?? m.cash_register_id,
      deposit_commission_pct: Number(edit.deposit_commission_pct ?? m.deposit_commission_pct),
      withdrawal_commission_pct: Number(edit.withdrawal_commission_pct ?? m.withdrawal_commission_pct),
      active: m.active,
    };
    try {
      await api.put(`/payment-methods/${m.id}`, payload);
      toast.success(`${m.name} güncellendi`);
      setEditing((p) => { const c = {...p}; delete c[m.id]; return c; });
      load();
    } catch (e) { toast.error("Hata"); }
  };

  const reseed = async () => {
    if (!confirm("TÜM veriler silinip Excel'deki varsayılan yapıya sıfırlanacak. Emin misiniz?")) return;
    try {
      await api.post("/seed", null, { params: { force: true } });
      toast.success("Veriler sıfırlandı");
      load();
    } catch (e) { toast.error("Hata"); }
  };

  const kasaMap = Object.fromEntries(kasalar.map((k) => [k.id, k.name]));

  return (
    <div className="space-y-8" data-testid="ayarlar-page">
      {/* Payment methods */}
      <div>
        <h3 className="font-display text-lg text-white mb-4">Ödeme Yöntemleri & Komisyon Oranları</h3>
        <div className="border border-border rounded-sm bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Yöntem</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Bağlı Kasa</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-center">Yatırım Kom. %</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-center">Çekim Kom. %</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {methods.map((m) => (
                <TableRow key={m.id} className="border-border hover:bg-white/[0.02]" data-testid={`pm-row-${m.id}`}>
                  <TableCell className="font-medium text-white text-sm">{m.name}</TableCell>
                  <TableCell>
                    <Select
                      value={editing[m.id]?.cash_register_id ?? m.cash_register_id ?? ""}
                      onValueChange={(v) => setEditField(m.id, "cash_register_id", v)}
                    >
                      <SelectTrigger className="w-48 bg-transparent border-border rounded-sm h-8 text-xs" data-testid={`pm-kasa-${m.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {kasalar.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-center">
                    <Input
                      type="number"
                      step="0.1"
                      defaultValue={m.deposit_commission_pct}
                      onChange={(e) => setEditField(m.id, "deposit_commission_pct", e.target.value)}
                      className="w-20 mx-auto text-center font-data bg-transparent border-border rounded-sm h-8 text-xs"
                      data-testid={`pm-dep-${m.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Input
                      type="number"
                      step="0.1"
                      defaultValue={m.withdrawal_commission_pct}
                      onChange={(e) => setEditField(m.id, "withdrawal_commission_pct", e.target.value)}
                      className="w-20 mx-auto text-center font-data bg-transparent border-border rounded-sm h-8 text-xs"
                      data-testid={`pm-wd-${m.id}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" onClick={() => savePm(m)} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1 active:scale-95" data-testid={`pm-save-${m.id}`}>
                      <Save className="w-3 h-3" /> Kaydet
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Info panels */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-border rounded-sm bg-card p-5">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-3">Kasalar</div>
          <ul className="space-y-1.5 text-sm font-data text-neutral-300">
            {kasalar.map((k) => <li key={k.id} data-testid={`settings-kasa-${k.name}`}>{k.name}</li>)}
          </ul>
        </div>
        <div className="border border-border rounded-sm bg-card p-5">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-3">Krediciler</div>
          <ul className="space-y-1.5 text-sm font-data text-neutral-300">
            {debtors.map((d) => <li key={d.id} data-testid={`settings-debtor-${d.name}`}>{d.name}</li>)}
          </ul>
        </div>
      </div>

      {/* Danger zone */}
      <div className="border border-[hsl(345_100%_60%)]/40 rounded-sm bg-[hsl(345_100%_60%)]/[0.03] p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[hsl(345_100%_65%)] mt-0.5" />
          <div className="flex-1">
            <h4 className="font-display text-base text-white mb-1">Tüm Verileri Sıfırla</h4>
            <p className="text-xs text-neutral-400 mb-4">Bu işlem tüm işlemleri, giderleri, transferleri ve kredi kayıtlarını siler. Kasalar, ödeme yöntemleri ve krediciler Excel'deki başlangıç yapısına döner.</p>
            <Button onClick={reseed} variant="outline" className="rounded-sm border-[hsl(345_100%_60%)]/40 text-[hsl(345_100%_65%)] hover:bg-[hsl(345_100%_60%)]/10 gap-2 active:scale-95" data-testid="settings-reseed">
              <RefreshCw className="w-4 h-4" /> Sıfırla ve Yeniden Yükle
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

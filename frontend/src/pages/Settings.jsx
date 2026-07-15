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

      {/* Editable Kasalar */}
      <div>
        <h3 className="font-display text-lg text-white mb-4">Kasalar</h3>
        <div className="border border-border rounded-sm bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Kasa İsmi</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Açılış Bakiyesi</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kasalar.map((k) => <KasaRow key={k.id} kasa={k} onSaved={load} />)}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Editable Krediciler */}
      <div>
        <h3 className="font-display text-lg text-white mb-4">Krediciler</h3>
        <div className="border border-border rounded-sm bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Kredici İsmi</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Açılış Bakiyesi</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {debtors.map((d) => <DebtorRow key={d.id} debtor={d} onSaved={load} />)}
            </TableBody>
          </Table>
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

function KasaRow({ kasa, onSaved }) {
  const [name, setName] = useState(kasa.name);
  const [initial, setInitial] = useState(kasa.initial_balance || 0);
  const [saving, setSaving] = useState(false);
  const changed = name !== kasa.name || Number(initial) !== Number(kasa.initial_balance || 0);

  const save = async () => {
    if (!name.trim()) return toast.error("İsim boş olamaz");
    setSaving(true);
    try {
      await api.put(`/cash-registers/${kasa.id}`, {
        name: name.trim(),
        type: kasa.type || "main",
        parent_id: kasa.parent_id || null,
        initial_balance: Number(initial) || 0,
      });
      toast.success(`${name} güncellendi`);
      onSaved();
    } catch (e) {
      toast.error("Kayıt hatası");
    } finally {
      setSaving(false);
    }
  };

  return (
    <TableRow className="border-border hover:bg-white/[0.02]" data-testid={`kasa-edit-row-${kasa.id}`}>
      <TableCell>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-xs bg-transparent border-border rounded-sm h-8 text-sm"
          data-testid={`kasa-name-${kasa.id}`}
        />
      </TableCell>
      <TableCell className="text-right">
        <Input
          type="number"
          step="0.01"
          value={initial}
          onChange={(e) => setInitial(e.target.value)}
          className="w-36 ml-auto text-right font-data bg-transparent border-border rounded-sm h-8 text-xs"
          data-testid={`kasa-initial-${kasa.id}`}
        />
      </TableCell>
      <TableCell>
        <Button
          size="sm"
          onClick={save}
          disabled={!changed || saving}
          className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1 active:scale-95 disabled:opacity-40"
          data-testid={`kasa-save-${kasa.id}`}
        >
          <Save className="w-3 h-3" /> Kaydet
        </Button>
      </TableCell>
    </TableRow>
  );
}

function DebtorRow({ debtor, onSaved }) {
  const [name, setName] = useState(debtor.name);
  const [initial, setInitial] = useState(debtor.initial_balance || 0);
  const [saving, setSaving] = useState(false);
  const changed = name !== debtor.name || Number(initial) !== Number(debtor.initial_balance || 0);

  const save = async () => {
    if (!name.trim()) return toast.error("İsim boş olamaz");
    setSaving(true);
    try {
      await api.put(`/debtors/${debtor.id}`, {
        name: name.trim(),
        initial_balance: Number(initial) || 0,
      });
      toast.success(`${name} güncellendi`);
      onSaved();
    } catch (e) {
      toast.error("Kayıt hatası");
    } finally {
      setSaving(false);
    }
  };

  return (
    <TableRow className="border-border hover:bg-white/[0.02]" data-testid={`debtor-edit-row-${debtor.id}`}>
      <TableCell>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-xs bg-transparent border-border rounded-sm h-8 text-sm"
          data-testid={`debtor-name-${debtor.id}`}
        />
      </TableCell>
      <TableCell className="text-right">
        <Input
          type="number"
          step="0.01"
          value={initial}
          onChange={(e) => setInitial(e.target.value)}
          className="w-36 ml-auto text-right font-data bg-transparent border-border rounded-sm h-8 text-xs"
          data-testid={`debtor-initial-${debtor.id}`}
        />
      </TableCell>
      <TableCell>
        <Button
          size="sm"
          onClick={save}
          disabled={!changed || saving}
          className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1 active:scale-95 disabled:opacity-40"
          data-testid={`debtor-save-${debtor.id}`}
        >
          <Save className="w-3 h-3" /> Kaydet
        </Button>
      </TableCell>
    </TableRow>
  );
}

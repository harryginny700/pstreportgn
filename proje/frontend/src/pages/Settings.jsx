import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, Save, Plus, Trash2, ChevronUp, ChevronDown, Send } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function Settings() {
  const [methods, setMethods] = useState([]);
  const [kasalar, setKasalar] = useState([]);
  const [debtors, setDebtors] = useState([]);
  const [editing, setEditing] = useState({}); // pm.id -> local edit map
  const [newPm, setNewPm] = useState({ name: "", cash_register_id: "", deposit_commission_pct: 0, withdrawal_commission_pct: 0 });
  const [newKasa, setNewKasa] = useState({ name: "", initial_balance: 0 });
  const [newDebtor, setNewDebtor] = useState({ name: "", initial_balance: 0 });

  const load = async () => {
    const [m, k, d] = await Promise.all([
      api.get("/payment-methods"),
      api.get("/cash-registers"),
      api.get("/debtors"),
    ]);
    setMethods(m.data);
    setKasalar(k.data);
    setDebtors(d.data);
    setEditing({});
  };
  useEffect(() => { load(); }, []);

  const setEditField = (id, field, val) => {
    setEditing((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: val } }));
  };

  const savePm = async (m) => {
    const edit = editing[m.id] || {};
    const name = (edit.name ?? m.name).trim();
    if (!name) return toast.error("İsim boş olamaz");
    const payload = {
      name,
      cash_register_id: edit.cash_register_id ?? m.cash_register_id,
      deposit_commission_pct: Number(edit.deposit_commission_pct ?? m.deposit_commission_pct),
      withdrawal_commission_pct: Number(edit.withdrawal_commission_pct ?? m.withdrawal_commission_pct),
      active: m.active,
    };
    try {
      await api.put(`/payment-methods/${m.id}`, payload);
      toast.success(`${name} güncellendi`);
      load();
    } catch (e) { toast.error("Hata"); }
  };

  const deletePm = async (m) => {
    if (!confirm(`${m.name} silinsin mi? Bu yönteme ait geçmiş işlemler DB'de kalır ama listelenmez.`)) return;
    try {
      await api.delete(`/payment-methods/${m.id}`);
      toast.success("Silindi");
      load();
    } catch (e) { toast.error("Hata"); }
  };

  const movePm = async (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= methods.length) return;
    const next = [...methods];
    [next[index], next[target]] = [next[target], next[index]];
    setMethods(next); // optimistic
    try {
      await api.post("/payment-methods/reorder", next.map((m) => m.id));
    } catch (e) {
      toast.error("Sıralama hatası");
      load();
    }
  };

  const addPm = async () => {
    if (!newPm.name.trim()) return toast.error("İsim girin");
    if (!newPm.cash_register_id) return toast.error("Bağlı kasa seçin");
    try {
      await api.post("/payment-methods", {
        ...newPm,
        name: newPm.name.trim(),
        deposit_commission_pct: Number(newPm.deposit_commission_pct) || 0,
        withdrawal_commission_pct: Number(newPm.withdrawal_commission_pct) || 0,
      });
      toast.success("Ödeme yöntemi eklendi");
      setNewPm({ name: "", cash_register_id: "", deposit_commission_pct: 0, withdrawal_commission_pct: 0 });
      load();
    } catch (e) { toast.error("Hata"); }
  };

  const addKasa = async () => {
    if (!newKasa.name.trim()) return toast.error("İsim girin");
    try {
      await api.post("/cash-registers", {
        name: newKasa.name.trim(),
        type: "main",
        initial_balance: Number(newKasa.initial_balance) || 0,
      });
      toast.success("Kasa eklendi");
      setNewKasa({ name: "", initial_balance: 0 });
      load();
    } catch (e) { toast.error("Hata"); }
  };

  const deleteKasa = async (k) => {
    if (!confirm(`${k.name} silinsin mi?`)) return;
    try {
      await api.delete(`/cash-registers/${k.id}`);
      toast.success("Silindi");
      load();
    } catch (e) { toast.error("Hata"); }
  };

  const addDebtor = async () => {
    if (!newDebtor.name.trim()) return toast.error("İsim girin");
    try {
      await api.post("/debtors", {
        name: newDebtor.name.trim(),
        initial_balance: Number(newDebtor.initial_balance) || 0,
      });
      toast.success("Manuel sağlayıcı eklendi");
      setNewDebtor({ name: "", initial_balance: 0 });
      load();
    } catch (e) { toast.error("Hata"); }
  };

  const deleteDebtor = async (d) => {
    if (!confirm(`${d.name} silinsin mi?`)) return;
    try {
      await api.delete(`/debtors/${d.id}`);
      toast.success("Silindi");
      load();
    } catch (e) { toast.error("Hata"); }
  };

  const reseed = async () => {
    toast.info("Bu özellik artık Admin Panel'de. Site oluştururken 'Varsayılan Yükle' butonunu kullanın.");
  };

  return (
    <div className="space-y-8" data-testid="ayarlar-page">
      {/* Payment methods */}
      <div>
        <h3 className="font-display text-lg text-white mb-4">Ödeme Yöntemleri & Komisyon Oranları</h3>
        <div className="border border-border rounded-sm bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 w-16">Sıra</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Yöntem İsmi</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Bağlı Kasa</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-center">Yatırım Kom. %</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-center">Çekim Kom. %</TableHead>
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {methods.map((m, idx) => (
                <TableRow key={m.id} className="border-border hover:bg-white/[0.02]" data-testid={`pm-row-${m.id}`}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => movePm(idx, -1)}
                        disabled={idx === 0}
                        className="h-5 w-8 rounded-sm text-neutral-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        data-testid={`pm-up-${m.id}`}
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => movePm(idx, 1)}
                        disabled={idx === methods.length - 1}
                        className="h-5 w-8 rounded-sm text-neutral-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        data-testid={`pm-down-${m.id}`}
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      defaultValue={m.name}
                      onChange={(e) => setEditField(m.id, "name", e.target.value)}
                      className="max-w-xs bg-transparent border-border rounded-sm h-8 text-sm"
                      data-testid={`pm-name-${m.id}`}
                    />
                  </TableCell>
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
                    <div className="flex gap-1.5 justify-end">
                      <Button size="sm" onClick={() => savePm(m)} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1 active:scale-95" data-testid={`pm-save-${m.id}`}>
                        <Save className="w-3 h-3" /> Kaydet
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => deletePm(m)} className="h-8 w-8 rounded-sm text-neutral-500 hover:text-red-400" data-testid={`pm-delete-${m.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {/* Add new payment method row */}
              <TableRow className="border-border bg-secondary/30 hover:bg-secondary/40" data-testid="pm-add-row">
                <TableCell></TableCell>
                <TableCell>
                  <Input
                    placeholder="Yeni yöntem ismi..."
                    value={newPm.name}
                    onChange={(e) => setNewPm({ ...newPm, name: e.target.value })}
                    className="max-w-xs bg-transparent border-border rounded-sm h-8 text-sm"
                    data-testid="pm-new-name"
                  />
                </TableCell>
                <TableCell>
                  <Select value={newPm.cash_register_id} onValueChange={(v) => setNewPm({ ...newPm, cash_register_id: v })}>
                    <SelectTrigger className="w-48 bg-transparent border-border rounded-sm h-8 text-xs" data-testid="pm-new-kasa"><SelectValue placeholder="Kasa seçin" /></SelectTrigger>
                    <SelectContent>
                      {kasalar.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-center">
                  <Input type="number" step="0.1" value={newPm.deposit_commission_pct} onChange={(e) => setNewPm({ ...newPm, deposit_commission_pct: e.target.value })} className="w-20 mx-auto text-center font-data bg-transparent border-border rounded-sm h-8 text-xs" data-testid="pm-new-dep" />
                </TableCell>
                <TableCell className="text-center">
                  <Input type="number" step="0.1" value={newPm.withdrawal_commission_pct} onChange={(e) => setNewPm({ ...newPm, withdrawal_commission_pct: e.target.value })} className="w-20 mx-auto text-center font-data bg-transparent border-border rounded-sm h-8 text-xs" data-testid="pm-new-wd" />
                </TableCell>
                <TableCell>
                  <Button size="sm" onClick={addPm} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1 active:scale-95 ml-auto flex" data-testid="pm-add-submit">
                    <Plus className="w-3 h-3" /> Ekle
                  </Button>
                </TableCell>
              </TableRow>
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
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kasalar.map((k) => <KasaRow key={k.id} kasa={k} onSaved={load} onDelete={() => deleteKasa(k)} />)}
              <TableRow className="border-border bg-secondary/30 hover:bg-secondary/40" data-testid="kasa-add-row">
                <TableCell>
                  <Input placeholder="Yeni kasa ismi..." value={newKasa.name} onChange={(e) => setNewKasa({ ...newKasa, name: e.target.value })} className="max-w-xs bg-transparent border-border rounded-sm h-8 text-sm" data-testid="kasa-new-name" />
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" value={newKasa.initial_balance} onChange={(e) => setNewKasa({ ...newKasa, initial_balance: e.target.value })} className="w-36 ml-auto text-right font-data bg-transparent border-border rounded-sm h-8 text-xs" data-testid="kasa-new-initial" />
                </TableCell>
                <TableCell>
                  <Button size="sm" onClick={addKasa} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1 active:scale-95 ml-auto flex" data-testid="kasa-add-submit">
                    <Plus className="w-3 h-3" /> Ekle
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Editable Manuel Sağlayıcılar */}
      <div>
        <h3 className="font-display text-lg text-white mb-4">Manuel Sağlayıcılar</h3>
        <div className="border border-border rounded-sm bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Manuel Sağlayıcı İsmi</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Açılış Bakiyesi</TableHead>
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {debtors.map((d) => <DebtorRow key={d.id} debtor={d} onSaved={load} onDelete={() => deleteDebtor(d)} />)}
              <TableRow className="border-border bg-secondary/30 hover:bg-secondary/40" data-testid="debtor-add-row">
                <TableCell>
                  <Input placeholder="Yeni kredici ismi..." value={newDebtor.name} onChange={(e) => setNewDebtor({ ...newDebtor, name: e.target.value })} className="max-w-xs bg-transparent border-border rounded-sm h-8 text-sm" data-testid="debtor-new-name" />
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" step="0.01" value={newDebtor.initial_balance} onChange={(e) => setNewDebtor({ ...newDebtor, initial_balance: e.target.value })} className="w-36 ml-auto text-right font-data bg-transparent border-border rounded-sm h-8 text-xs" data-testid="debtor-new-initial" />
                </TableCell>
                <TableCell>
                  <Button size="sm" onClick={addDebtor} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1 active:scale-95 ml-auto flex" data-testid="debtor-add-submit">
                    <Plus className="w-3 h-3" /> Ekle
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Telegram integration (site users only) */}
      <TelegramSection />

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

function KasaRow({ kasa, onSaved, onDelete }) {  const [name, setName] = useState(kasa.name);
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
        <div className="flex gap-1.5 justify-end">
          <Button
            size="sm"
            onClick={save}
            disabled={!changed || saving}
            className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1 active:scale-95 disabled:opacity-40"
            data-testid={`kasa-save-${kasa.id}`}
          >
            <Save className="w-3 h-3" /> Kaydet
          </Button>
          <Button size="icon" variant="ghost" onClick={onDelete} className="h-8 w-8 rounded-sm text-neutral-500 hover:text-red-400" data-testid={`kasa-delete-${kasa.id}`}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function DebtorRow({ debtor, onSaved, onDelete }) {
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
        <div className="flex gap-1.5 justify-end">
          <Button
            size="sm"
            onClick={save}
            disabled={!changed || saving}
            className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1 active:scale-95 disabled:opacity-40"
            data-testid={`debtor-save-${debtor.id}`}
          >
            <Save className="w-3 h-3" /> Kaydet
          </Button>
          <Button size="icon" variant="ghost" onClick={onDelete} className="h-8 w-8 rounded-sm text-neutral-500 hover:text-red-400" data-testid={`debtor-delete-${debtor.id}`}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}


function TelegramSection() {
  const { isAdmin } = useAuth();
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    if (isAdmin) { setLoading(false); return; }
    api.get("/site/telegram-config")
      .then((r) => {
        setToken(r.data.telegram_bot_token || "");
        setChatId(r.data.telegram_chat_id || "");
        setConfigured(r.data.configured);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAdmin]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/site/telegram-config", {
        telegram_bot_token: token.trim() || null,
        telegram_chat_id: chatId.trim() || null,
      });
      toast.success("Telegram ayarları kaydedildi");
      setConfigured(!!(token.trim() && chatId.trim()));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kayıt hatası");
    } finally { setSaving(false); }
  };

  if (isAdmin) {
    return (
      <div className="border border-border rounded-sm bg-card p-4 md:p-5" data-testid="telegram-admin-note">
        <div className="flex items-center gap-3 mb-2">
          <Send className="w-4 h-4 text-primary" />
          <h3 className="font-display text-lg text-foreground">Telegram Entegrasyonu</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Admin olarak sitelerin Telegram konfigürasyonunu yönetmiyorsunuz. Site kullanıcıları
          giriş yaptıklarında kendi ayarlarını buradan yönetir. Test için bir site kullanıcısıyla giriş yapın.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-sm bg-card p-4 md:p-5" data-testid="telegram-section">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Send className="w-4 h-4 text-primary" />
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Entegrasyon</div>
            <h3 className="font-display text-lg text-foreground mt-0.5">Telegram Bot</h3>
          </div>
        </div>
        {configured && (
          <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-sm border text-[hsl(144_100%_55%)] border-[hsl(144_100%_50%)]/30 bg-[hsl(144_100%_50%)]/10">Aktif</span>
        )}
      </div>
      {loading ? (
        <div className="text-xs text-muted-foreground font-data">Yükleniyor...</div>
      ) : (
        <>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Bot Token</label>
              <Input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456789:AAH..."
                className="bg-transparent border-border rounded-sm h-9 font-data text-xs"
                data-testid="telegram-token"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Grup / Chat ID</label>
              <Input
                type="text"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="-1001234567890"
                className="bg-transparent border-border rounded-sm h-9 font-data text-xs"
                data-testid="telegram-chat-id"
              />
            </div>
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
            <p>• BotFather'dan yeni bir bot oluşturup token'ı alın.</p>
            <p>• Botu gruba ekleyip <span className="font-data">/start</span> gönderin.</p>
            <p>• Grup ID'sini almak için <span className="font-data">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</span> URL'ini açıp <span className="font-data">chat.id</span> değerini kopyalayın (negatif sayı).</p>
          </div>
          <Button
            onClick={save}
            disabled={saving}
            className="mt-4 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95 disabled:opacity-50"
            data-testid="telegram-save"
          >
            <Save className="w-4 h-4" /> {saving ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </>
      )}
    </div>
  );
}


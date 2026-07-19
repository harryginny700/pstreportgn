import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { HandCoins, Plus, Trash2, Check, RotateCcw, Loader2, Percent, Landmark, Send, Archive, ArchiveRestore, Bell, Rocket, Globe, Store } from "lucide-react";

export default function AdminCredits() {
  const [sites, setSites] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterSite, setFilterSite] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [viewArchived, setViewArchived] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ site_id: "", amount: "", commission_pct: "", note: "" });
  const [saving, setSaving] = useState(false);
  // Setup (Yeni Kurulum) modal
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupForm, setSetupForm] = useState({ name: "", type: "online", amount: "", commission_pct: "10", setup_fee: "", setup_fee_partner_name: "Playspintech", note: "" });
  const [settingUp, setSettingUp] = useState(false);
  // Payment modal state
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState(null); // credit row
  const [payForm, setPayForm] = useState({ amount: "", date: "", note: "", paid_currency: "TRY" });
  const [paying, setPaying] = useState(false);
  const [reminding, setReminding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterSite !== "all") params.site_id = filterSite;
      if (filterStatus !== "all") params.status = filterStatus;
      if (viewArchived) params.archived = true;
      const [s, r] = await Promise.all([
        api.get("/admin/sites"),
        api.get("/admin/site-credits", { params }),
      ]);
      setSites(s.data || []);
      setRows(r.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [filterSite, filterStatus, viewArchived]);

  useEffect(() => { load(); }, [load]);

  const previewDebt = useMemo(() => {
    const a = parseFloat(form.amount || 0);
    const p = parseFloat(form.commission_pct || 0);
    if (!a || isNaN(a) || isNaN(p)) return 0;
    return Math.round(a * p) / 100;
  }, [form.amount, form.commission_pct]);

  const openAdd = () => {
    setForm({ site_id: sites[0]?.id || "", amount: "", commission_pct: "", note: "" });
    setAddOpen(true);
  };

  const create = async () => {
    if (!form.site_id) return toast.error("Site seçin");
    const amount = parseFloat(form.amount);
    const pct = parseFloat(form.commission_pct);
    if (isNaN(amount) || amount <= 0) return toast.error("Geçerli bir kredi miktarı girin");
    if (isNaN(pct) || pct < 0) return toast.error("Geçerli bir yüzde girin");
    setSaving(true);
    try {
      await api.post("/admin/site-credits", {
        site_id: form.site_id,
        amount,
        commission_pct: pct,
        note: form.note || null,
      });
      toast.success("Kredi eklendi");
      setAddOpen(false);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Eklenemedi");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (row) => {
    // Reset a paid credit back to unpaid (clears all payments)
    if (row.status !== "paid") return;
    if (!confirm(`${row.site_name} — bu ödendi kaydını geri alıp ödemeleri sıfırlansın mı?`)) return;
    try {
      await api.patch(`/admin/site-credits/${row.id}/status`, null, { params: { status: "unpaid" } });
      toast.success("Kayıt sıfırlandı (ödemeler silindi)");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Güncellenemedi");
    }
  };

  const openPay = (row) => {
    const remaining = Math.max(0, (row.debt || 0) - (row.paid_amount || 0));
    setPayTarget(row);
    setPayForm({
      amount: remaining.toString(),
      date: new Date().toISOString().slice(0, 10),
      note: "",
      paid_currency: "TRY",
      splits: { Playspintech: remaining.toString(), Harry: "0", Bozo: "0", Memo: "0" },
    });
    setPayOpen(true);
  };

  const setSplitAmount = (partner, value) => {
    setPayForm(p => ({ ...p, splits: { ...p.splits, [partner]: value } }));
  };

  const splitTotal = () => {
    if (!payForm.splits) return 0;
    return Object.values(payForm.splits).reduce((a, v) => a + (parseFloat(v) || 0), 0);
  };

  const distributeAllTo = (partner) => {
    // Distribute the TL-equivalent (splits are always TRY)
    const rate = parseFloat(payTarget?.exchange_rate) || 30;
    const amt = parseFloat(payForm.amount) || 0;
    const amtTry = payForm.paid_currency === "USD" ? amt * rate : amt;
    const next = { Playspintech: "0", Harry: "0", Bozo: "0", Memo: "0" };
    next[partner] = amtTry.toString();
    setPayForm(p => ({ ...p, splits: next }));
  };

  const submitPayment = async () => {
    if (!payTarget) return;
    const amount = parseFloat(payForm.amount);
    if (isNaN(amount) || amount <= 0) return toast.error("Geçerli bir ödeme tutarı girin");
    const isUsd = payForm.paid_currency === "USD";
    const rate = parseFloat(payTarget.exchange_rate) || 30;
    const remainingTry = (payTarget.debt || 0) - (payTarget.paid_amount || 0);
    const remainingUsd = (payTarget.debt_usd || 0) - (payTarget.paid_amount_usd || 0);
    // Validate against the correct currency's remaining
    if (isUsd) {
      if (amount > remainingUsd + 0.01) return toast.error(`Kalan USD borç $${remainingUsd.toFixed(2)} — daha fazlası ödenemez`);
    } else {
      if (amount > remainingTry + 0.01) return toast.error(`Kalan borç ${fmtTRY(remainingTry)} — daha fazlası ödenemez`);
    }
    // For splits: convert USD to TRY (at credit's locked rate) to keep splits in TRY
    const amountTryForSplits = isUsd ? amount * rate : amount;
    const splits = Object.entries(payForm.splits || {}).map(([kasa, v]) => ({ kasa, amount: parseFloat(v) || 0 })).filter(s => s.amount > 0);
    const sTotal = splits.reduce((a, b) => a + b.amount, 0);
    if (Math.abs(sTotal - amountTryForSplits) > 0.01) {
      return toast.error(`Dağılım toplamı (${fmtTRY(sTotal)}) ödeme TL karşılığına (${fmtTRY(amountTryForSplits)}) eşit olmalı`);
    }
    setPaying(true);
    try {
      await api.post(`/admin/site-credits/${payTarget.id}/payments`, {
        amount,
        date: payForm.date || null,
        note: payForm.note || null,
        splits,
        paid_currency: payForm.paid_currency || "TRY",
      });
      toast.success(isUsd ? `$${amount} USD ödeme kaydedildi` : "Ödeme kaydedildi ve dağıtıldı");
      setPayOpen(false);
      setPayTarget(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Ödeme kaydedilemedi");
    } finally {
      setPaying(false);
    }
  };

  const remove = async (row) => {
    if (!confirm(`${row.site_name} — ${fmtTRY(row.amount)} kredisi silinsin mi?`)) return;
    try {
      await api.delete(`/admin/site-credits/${row.id}`);
      toast.success("Silindi");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Silinemedi");
    }
  };

  const sendReminders = async () => {
    if (!confirm("Telegram konfigüre edilmiş ve ödenmemiş borcu olan tüm sitelere hatırlatma gönderilsin mi?")) return;
    setReminding(true);
    try {
      const r = await api.post("/admin/site-credits/send-reminders");
      toast.success(`${r.data.sent} site'a hatırlatma gönderildi (${r.data.skipped_no_debt} site borçsuz)`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Gönderilemedi");
    } finally {
      setReminding(false);
    }
  };

  const archive = async (row) => {
    const next = !row.archived;
    if (next && !confirm(`${row.site_name} — ${fmtTRY(row.amount)} kredisi arşivlensin mi?`)) return;
    try {
      await api.patch(`/admin/site-credits/${row.id}/archive`, null, { params: { archived: next } });
      toast.success(next ? "Arşivlendi" : "Arşivden çıkarıldı");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Güncellenemedi");
    }
  };

  const submitSetup = async () => {
    const name = (setupForm.name || "").trim();
    if (!name) return toast.error("Site adı gerekli");
    const amount = parseFloat(setupForm.amount);
    const pct = parseFloat(setupForm.commission_pct);
    if (isNaN(amount) || amount <= 0) return toast.error("Kredi tutarı 0'dan büyük olmalı");
    if (isNaN(pct) || pct < 0) return toast.error("Geçerli bir komisyon oranı girin");
    const setupFeeRaw = (setupForm.setup_fee || "").toString().trim();
    let setupFee = 0;
    if (setupFeeRaw !== "") {
      setupFee = parseFloat(setupFeeRaw);
      if (isNaN(setupFee) || setupFee < 0) return toast.error("Kurulum ücreti geçersiz");
    }
    if (setupFee > 0 && !["Playspintech", "Harry", "Bozo", "Memo"].includes(setupForm.setup_fee_partner_name)) {
      return toast.error("Kurulum ücreti için kasa seçin");
    }
    setSettingUp(true);
    try {
      const payload = {
        name,
        type: setupForm.type,
        amount,
        commission_pct: pct,
        note: setupForm.note || null,
      };
      if (setupFee > 0) {
        payload.setup_fee = setupFee;
        payload.setup_fee_partner_name = setupForm.setup_fee_partner_name;
      }
      const r = await api.post("/admin/setup", payload);
      const tg = r.data?.telegram || {};
      const feeMsg = r.data?.setup_fee
        ? ` · Kurulum ücreti ₺${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2 }).format(r.data.setup_fee.amount)} → ${r.data.setup_fee.kasa}`
        : "";
      toast.success(`${name} kuruldu · Kredi açıldı${feeMsg}${tg.ok ? " · Telegram gönderildi" : (tg.error === "not_configured" ? " · Admin Telegram yapılandırılmadığından bildirim atlandı" : "")}`);
      setSetupOpen(false);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kurulum başarısız");
    } finally {
      setSettingUp(false);
    }
  };

  const totals = useMemo(() => {
    let unpaid = 0, paid = 0, totalAmount = 0, totalDebt = 0;
    rows.forEach(r => {
      const remaining = Math.max(0, (r.debt || 0) - (r.paid_amount || 0));
      totalAmount += r.amount;
      totalDebt += r.debt;
      paid += r.paid_amount || 0;
      if (r.status !== "paid") unpaid += remaining;
    });
    return { unpaid, paid, totalAmount, totalDebt };
  }, [rows]);

  return (
    <div className="space-y-6" data-testid="admin-credits-page">
      {/* Header + summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard icon={HandCoins} label="Toplam Verilen Kredi" value={fmtTRY(totals.totalAmount)} />
        <SummaryCard icon={Percent} label="Toplam Borç (%)" value={fmtTRY(totals.totalDebt)} />
        <SummaryCard icon={Landmark} label="Bekleyen Borç" value={fmtTRY(totals.unpaid)} tone="warning" testid="ac-unpaid-total" />
        <SummaryCard icon={Check} label="Ödenmiş Borç" value={fmtTRY(totals.paid)} tone="success" />
      </div>

      {/* Filters + add */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterSite} onValueChange={setFilterSite}>
            <SelectTrigger className="w-48 h-9 rounded-sm bg-transparent border-border text-xs" data-testid="ac-filter-site">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm siteler</SelectItem>
              {sites.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40 h-9 rounded-sm bg-transparent border-border text-xs" data-testid="ac-filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm durumlar</SelectItem>
              <SelectItem value="unpaid">Ödenmedi</SelectItem>
              <SelectItem value="partial">Kısmi</SelectItem>
              <SelectItem value="paid">Ödendi</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            onClick={() => setViewArchived(v => !v)}
            className={`h-9 rounded-sm text-xs gap-1.5 border ${viewArchived ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
            data-testid="ac-toggle-archived-view"
          >
            <Archive className="w-3.5 h-3.5" /> {viewArchived ? "Arşivi gizle" : "Arşivi göster"}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={sendReminders}
            disabled={reminding}
            variant="ghost"
            className="rounded-sm border border-border h-9 gap-2 active:scale-95 text-xs"
            data-testid="ac-send-reminders-btn"
            title="Tüm sitelere ödenmemiş borç hatırlatması gönder"
          >
            {reminding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
            Hatırlatma Gönder
          </Button>
          <Button onClick={openAdd} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95" data-testid="ac-add-btn">
            <Plus className="w-3.5 h-3.5" /> Yeni Kredi
          </Button>
          <Button
            onClick={() => { setSetupForm({ name: "", type: "online", amount: "", commission_pct: "10", setup_fee: "", setup_fee_partner_name: "Playspintech", note: "" }); setSetupOpen(true); }}
            className="rounded-sm bg-[hsl(200_100%_55%)] text-black hover:bg-[hsl(200_100%_65%)] h-9 gap-2 active:scale-95"
            data-testid="ac-setup-btn"
          >
            <Rocket className="w-3.5 h-3.5" /> Yeni Kurulum
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-sm bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Tarih</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Site</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">Kredi Miktarı</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">%</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">Borç</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">Ödenmiş / Kalan</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Durum</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Not</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-right">Aksiyon</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow className="border-border"><TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-6">Yükleniyor...</TableCell></TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow className="border-border"><TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-8">Kayıt yok</TableCell></TableRow>
            )}
            {!loading && rows.map(r => {
              const paidAmt = r.paid_amount || 0;
              const remaining = Math.max(0, (r.debt || 0) - paidAmt);
              const isPaid = r.status === "paid";
              const isPartial = r.status === "partial" || (paidAmt > 0 && !isPaid);
              return (
              <TableRow key={r.id} className="border-border" data-testid={`ac-row-${r.id}`}>
                <TableCell className="font-data text-xs text-foreground">{r.date}</TableCell>
                <TableCell className="text-sm text-foreground">{r.site_name}</TableCell>
                <TableCell className="text-right font-data text-sm text-foreground">{fmtTRY(r.amount)}</TableCell>
                <TableCell className="text-right font-data text-xs text-muted-foreground">%{r.commission_pct}</TableCell>
                <TableCell className="text-right font-data text-sm text-foreground">{fmtTRY(r.debt)}</TableCell>
                <TableCell className="text-right font-data text-xs">
                  <div className="text-[hsl(144_100%_55%)]">{fmtTRY(paidAmt)}</div>
                  <div className={isPaid ? "text-muted-foreground" : "text-[hsl(45_100%_55%)] font-medium"}>{fmtTRY(remaining)}</div>
                </TableCell>
                <TableCell>
                  {isPaid ? (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded-sm border border-[hsl(144_100%_45%)] text-[hsl(144_100%_55%)]" data-testid={`ac-status-${r.id}`}>
                      <Check className="w-3 h-3" /> Ödendi
                    </span>
                  ) : isPartial ? (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded-sm border border-[hsl(200_100%_55%)] text-[hsl(200_100%_65%)]" data-testid={`ac-status-${r.id}`}>
                      Kısmi
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded-sm border border-[hsl(45_100%_55%)] text-[hsl(45_100%_55%)]" data-testid={`ac-status-${r.id}`}>
                      Ödenmedi
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate">{r.note || "—"}</TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex items-center gap-1">
                    {!isPaid && (
                      <Button size="sm" onClick={() => openPay(r)} className="h-7 px-2.5 rounded-sm text-xs bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 active:scale-95" data-testid={`ac-pay-${r.id}`}>
                        <Check className="w-3.5 h-3.5" /> Kredi Ödendi
                      </Button>
                    )}
                    {isPaid && (
                      <Button size="sm" variant="ghost" onClick={() => toggleStatus(r)} className="h-7 px-2 rounded-sm text-xs" data-testid={`ac-reset-${r.id}`} title="Ödemeleri sıfırla">
                        <RotateCcw className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => archive(r)} className={`h-7 px-2 rounded-sm text-xs ${r.archived ? "text-primary" : "text-muted-foreground hover:text-foreground"}`} data-testid={`ac-archive-${r.id}`} title={r.archived ? "Arşivden çıkar" : "Arşivle"}>
                      {r.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(r)} className="h-7 px-2 rounded-sm text-xs text-[hsl(345_100%_65%)] hover:text-[hsl(345_100%_75%)]" data-testid={`ac-delete-${r.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-card border-border rounded-sm max-w-md" data-testid="ac-add-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground flex items-center gap-2">
              <HandCoins className="w-4 h-4 text-primary" /> Yeni Kredi Kaydı
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Site">
              <Select value={form.site_id} onValueChange={(v) => setForm({ ...form, site_id: v })}>
                <SelectTrigger className="bg-transparent border-border rounded-sm h-9 text-sm" data-testid="ac-form-site">
                  <SelectValue placeholder="Site seçin" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kredi Miktarı (₺)">
                <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="bg-transparent border-border rounded-sm h-9 text-sm" data-testid="ac-form-amount" />
              </Field>
              <Field label="Yüzde (%)">
                <Input type="number" step="0.01" value={form.commission_pct} onChange={(e) => setForm({ ...form, commission_pct: e.target.value })} className="bg-transparent border-border rounded-sm h-9 text-sm" data-testid="ac-form-pct" />
              </Field>
            </div>
            <div className="border border-border rounded-sm bg-background p-3 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Hesaplanan Borç</div>
              <div className="font-data text-lg text-primary" data-testid="ac-form-debt-preview">{fmtTRY(previewDebt)}</div>
            </div>
            <Field label="Not (opsiyonel)">
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="bg-transparent border-border rounded-sm h-9 text-sm" data-testid="ac-form-note" />
            </Field>
          </div>
          <DialogFooter className="flex flex-row justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={saving} className="rounded-sm border border-border h-9" data-testid="ac-form-cancel">İptal</Button>
            <Button onClick={create} disabled={saving} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95" data-testid="ac-form-save">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Ekle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment dialog */}
      <Dialog open={payOpen} onOpenChange={(v) => { setPayOpen(v); if (!v) setPayTarget(null); }}>
        <DialogContent className="bg-card border-border rounded-sm max-w-md" data-testid="ac-pay-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground flex items-center gap-2">
              <Check className="w-4 h-4 text-primary" /> Kredi Ödemesi Kaydet
            </DialogTitle>
          </DialogHeader>
          {payTarget && (
            <div className="space-y-3">
              <div className="border border-border rounded-sm bg-background p-3 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Site</span>
                  <span className="text-foreground">{payTarget.site_name}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Toplam Borç</span>
                  <span className="font-data text-foreground">
                    {fmtTRY(payTarget.debt)}
                    {payTarget.debt_usd ? <span className="text-muted-foreground ml-1">· ${payTarget.debt_usd.toFixed(2)}</span> : null}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Şu ana kadar ödenmiş</span>
                  <span className="font-data text-[hsl(144_100%_55%)]">
                    {fmtTRY(payTarget.paid_amount || 0)}
                    {payTarget.paid_amount_usd ? <span className="text-muted-foreground ml-1">· ${(payTarget.paid_amount_usd || 0).toFixed(2)}</span> : null}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs pt-1 border-t border-border">
                  <span className="text-muted-foreground uppercase tracking-[0.2em] text-[10px]">Kalan Borç</span>
                  <span className="font-data text-[hsl(45_100%_55%)] text-base font-medium" data-testid="ac-pay-remaining">
                    {fmtTRY(Math.max(0, (payTarget.debt || 0) - (payTarget.paid_amount || 0)))}
                    {payTarget.debt_usd ? <span className="text-xs text-muted-foreground ml-1">· ${Math.max(0, (payTarget.debt_usd || 0) - (payTarget.paid_amount_usd || 0)).toFixed(2)}</span> : null}
                  </span>
                </div>
                {payTarget.exchange_rate ? (
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
                    <span>Sabit Kur (kredi açılışında)</span>
                    <span className="font-data">1 USD = {payTarget.exchange_rate.toFixed(2)} TRY</span>
                  </div>
                ) : null}
              </div>
              {/* Currency toggle */}
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Ödeme Para Birimi</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayForm({ ...payForm, paid_currency: "TRY" })}
                    className={`h-9 rounded-sm border text-sm flex items-center justify-center gap-2 transition-colors ${
                      payForm.paid_currency !== "USD"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid="ac-pay-cur-try"
                  >
                    ₺ TL
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayForm({ ...payForm, paid_currency: "USD" })}
                    className={`h-9 rounded-sm border text-sm flex items-center justify-center gap-2 transition-colors ${
                      payForm.paid_currency === "USD"
                        ? "border-[hsl(144_100%_55%)] bg-[hsl(144_100%_55%_/_0.08)] text-[hsl(144_100%_65%)]"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid="ac-pay-cur-usd"
                  >
                    $ USD
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Ödenen Tutar (${payForm.paid_currency === "USD" ? "$" : "₺"})`}>
                  <Input type="number" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} className="bg-transparent border-border rounded-sm h-9 text-sm" data-testid="ac-pay-amount" autoFocus />
                  {payForm.amount && payTarget.exchange_rate ? (
                    <div className="text-[10px] text-muted-foreground mt-1 font-data">
                      {payForm.paid_currency === "USD"
                        ? `≈ ${fmtTRY(parseFloat(payForm.amount) * payTarget.exchange_rate)}`
                        : `≈ $${(parseFloat(payForm.amount) / payTarget.exchange_rate).toFixed(2)}`}
                    </div>
                  ) : null}
                </Field>
                <Field label="Ödeme Tarihi">
                  <Input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} className="bg-transparent border-border rounded-sm h-9 text-sm font-data" data-testid="ac-pay-date" />
                </Field>
              </div>
              <Field label="Not (opsiyonel)">
                <Input value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} className="bg-transparent border-border rounded-sm h-9 text-sm" data-testid="ac-pay-note" />
              </Field>

              {/* Partner kasa splits */}
              <div className="border border-border rounded-sm p-3 space-y-2 bg-background">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Ortak Kasa Dağılımı</div>
                  <div className="text-[10px] text-muted-foreground">Toplam: <span className={`font-data ${Math.abs(splitTotal() - (parseFloat(payForm.amount) || 0)) < 0.01 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`} data-testid="ac-pay-split-total">{fmtTRY(splitTotal())}</span></div>
                </div>
                {["Playspintech", "Harry", "Bozo", "Memo"].map(p => (
                  <div key={p} className="grid grid-cols-[110px,1fr,auto] items-center gap-2">
                    <div className="text-xs text-foreground font-medium">{p}</div>
                    <Input
                      type="number"
                      step="0.01"
                      value={payForm.splits?.[p] ?? "0"}
                      onChange={(e) => setSplitAmount(p, e.target.value)}
                      className="bg-transparent border-border rounded-sm h-8 text-sm font-data"
                      data-testid={`ac-pay-split-${p}`}
                    />
                    <button type="button" onClick={() => distributeAllTo(p)} className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground px-1.5 py-1" title={`Tümünü ${p}'e ver`} data-testid={`ac-pay-split-all-${p}`}>
                      Tümü
                    </button>
                  </div>
                ))}
              </div>

              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-1.5">
                <Send className="w-3 h-3" /> Ödeme sonrası siteye Telegram bildirimi + ortak kasalara giriş yazılacak
              </div>
            </div>
          )}
          <DialogFooter className="flex flex-row justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setPayOpen(false)} disabled={paying} className="rounded-sm border border-border h-9" data-testid="ac-pay-cancel">İptal</Button>
            <Button onClick={submitPayment} disabled={paying} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95" data-testid="ac-pay-save">
              {paying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Ödemeyi Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Setup (Yeni Kurulum) dialog */}
      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="bg-card border-border rounded-sm max-w-md" data-testid="ac-setup-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground flex items-center gap-2">
              <Rocket className="w-4 h-4 text-[hsl(200_100%_55%)]" /> Yeni Site Kurulumu
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Kurulacak Site Adı">
              <Input
                value={setupForm.name}
                onChange={(e) => setSetupForm({ ...setupForm, name: e.target.value })}
                placeholder="Ör. YeniSite.com"
                className="bg-transparent border-border rounded-sm h-9 text-sm"
                data-testid="ac-setup-name"
              />
            </Field>
            <Field label="Site Tipi">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSetupForm({ ...setupForm, type: "online" })}
                  className={`h-11 rounded-sm border text-sm flex items-center justify-center gap-2 transition-colors ${
                    setupForm.type === "online"
                      ? "border-[hsl(200_100%_55%)] bg-[hsl(200_100%_55%_/_0.08)] text-[hsl(200_100%_65%)]"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid="ac-setup-type-online"
                >
                  <Globe className="w-4 h-4" /> Online
                </button>
                <button
                  type="button"
                  onClick={() => setSetupForm({ ...setupForm, type: "sokak" })}
                  className={`h-11 rounded-sm border text-sm flex items-center justify-center gap-2 transition-colors ${
                    setupForm.type === "sokak"
                      ? "border-[hsl(45_100%_55%)] bg-[hsl(45_100%_55%_/_0.08)] text-[hsl(45_100%_55%)]"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid="ac-setup-type-sokak"
                >
                  <Store className="w-4 h-4" /> Sokak
                </button>
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Verilecek Kredi (₺)">
                <Input
                  type="number"
                  step="0.01"
                  value={setupForm.amount}
                  onChange={(e) => setSetupForm({ ...setupForm, amount: e.target.value })}
                  placeholder="0.00"
                  className="bg-transparent border-border rounded-sm h-9 text-sm font-data"
                  data-testid="ac-setup-amount"
                />
              </Field>
              <Field label="Komisyon (%)">
                <Input
                  type="number"
                  step="0.01"
                  value={setupForm.commission_pct}
                  onChange={(e) => setSetupForm({ ...setupForm, commission_pct: e.target.value })}
                  className="bg-transparent border-border rounded-sm h-9 text-sm font-data"
                  data-testid="ac-setup-pct"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
              <Field label="Kurulum Tutarı (₺) — opsiyonel">
                <Input
                  type="number"
                  step="0.01"
                  value={setupForm.setup_fee}
                  onChange={(e) => setSetupForm({ ...setupForm, setup_fee: e.target.value })}
                  placeholder="0.00"
                  className="bg-transparent border-border rounded-sm h-9 text-sm font-data"
                  data-testid="ac-setup-fee"
                />
              </Field>
              <Field label="Gelir Girecek Kasa">
                <Select
                  value={setupForm.setup_fee_partner_name || "Playspintech"}
                  onValueChange={(v) => setSetupForm({ ...setupForm, setup_fee_partner_name: v })}
                >
                  <SelectTrigger className="bg-transparent border-border rounded-sm h-9 text-sm" data-testid="ac-setup-fee-partner">
                    <SelectValue placeholder="Kasa seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {["Playspintech", "Harry", "Bozo", "Memo"].map((p) => (
                      <SelectItem key={p} value={p} data-testid={`ac-setup-fee-partner-${p}`}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Not (opsiyonel)">
              <Input
                value={setupForm.note}
                onChange={(e) => setSetupForm({ ...setupForm, note: e.target.value })}
                className="bg-transparent border-border rounded-sm h-9 text-sm"
                data-testid="ac-setup-note"
              />
            </Field>
            <div className="text-[10px] text-muted-foreground border border-border rounded-sm p-2 space-y-0.5">
              <div>• Yeni site oluşturulur (Aktif)</div>
              <div>• Varsayılan kasalar + ödeme yöntemleri hazırlanır</div>
              <div>• İlk kredi kaydı açılır (aynı liste)</div>
              <div>• Kurulum ücreti girilirse seçilen ortak kasaya gelir olarak eklenir</div>
              <div>• Admin Telegram grubuna kurulum bildirimi gönderilir</div>
            </div>
          </div>
          <DialogFooter className="flex flex-row justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setSetupOpen(false)}
              disabled={settingUp}
              className="rounded-sm border border-border h-9"
              data-testid="ac-setup-cancel"
            >
              İptal
            </Button>
            <Button
              onClick={submitSetup}
              disabled={settingUp}
              className="rounded-sm bg-[hsl(200_100%_55%)] text-black hover:bg-[hsl(200_100%_65%)] h-9 gap-2 active:scale-95 disabled:opacity-60"
              data-testid="ac-setup-save"
            >
              {settingUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
              Kurulumu Başlat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, tone, testid }) {
  const toneCls = tone === "warning" ? "text-[hsl(45_100%_55%)]"
    : tone === "success" ? "text-[hsl(144_100%_55%)]"
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

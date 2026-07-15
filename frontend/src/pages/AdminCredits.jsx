import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { HandCoins, Plus, Trash2, Check, RotateCcw, Loader2, Percent, Landmark, Send, Archive, ArchiveRestore } from "lucide-react";

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
  // Payment modal state
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState(null); // credit row
  const [payForm, setPayForm] = useState({ amount: "", date: "", note: "" });
  const [paying, setPaying] = useState(false);

  const load = async () => {
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
  };

  useEffect(() => { load(); }, [filterSite, filterStatus, viewArchived]);

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
    setPayForm({ amount: remaining.toString(), date: new Date().toISOString().slice(0, 10), note: "" });
    setPayOpen(true);
  };

  const submitPayment = async () => {
    if (!payTarget) return;
    const amount = parseFloat(payForm.amount);
    if (isNaN(amount) || amount <= 0) return toast.error("Geçerli bir ödeme tutarı girin");
    const remaining = (payTarget.debt || 0) - (payTarget.paid_amount || 0);
    if (amount > remaining + 0.01) return toast.error(`Kalan borç ${fmtTRY(remaining)} — daha fazlası ödenemez`);
    setPaying(true);
    try {
      await api.post(`/admin/site-credits/${payTarget.id}/payments`, {
        amount,
        date: payForm.date || null,
        note: payForm.note || null,
      });
      toast.success("Ödeme kaydedildi ve Telegram'a bildirildi");
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
        <Button onClick={openAdd} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95" data-testid="ac-add-btn">
          <Plus className="w-3.5 h-3.5" /> Yeni Kredi
        </Button>
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
                  <span className="font-data text-foreground">{fmtTRY(payTarget.debt)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Şu ana kadar ödenmiş</span>
                  <span className="font-data text-[hsl(144_100%_55%)]">{fmtTRY(payTarget.paid_amount || 0)}</span>
                </div>
                <div className="flex items-center justify-between text-xs pt-1 border-t border-border">
                  <span className="text-muted-foreground uppercase tracking-[0.2em] text-[10px]">Kalan Borç</span>
                  <span className="font-data text-[hsl(45_100%_55%)] text-base font-medium" data-testid="ac-pay-remaining">{fmtTRY(Math.max(0, (payTarget.debt || 0) - (payTarget.paid_amount || 0)))}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Ödenen Tutar (₺)">
                  <Input type="number" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} className="bg-transparent border-border rounded-sm h-9 text-sm" data-testid="ac-pay-amount" autoFocus />
                </Field>
                <Field label="Ödeme Tarihi">
                  <Input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} className="bg-transparent border-border rounded-sm h-9 text-sm font-data" data-testid="ac-pay-date" />
                </Field>
              </div>
              <Field label="Not (opsiyonel)">
                <Input value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} className="bg-transparent border-border rounded-sm h-9 text-sm" data-testid="ac-pay-note" />
              </Field>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-1.5">
                <Send className="w-3 h-3" /> Ödeme sonrası siteye Telegram bildirimi gönderilecek
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

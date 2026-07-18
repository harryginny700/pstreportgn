import { useCallback, useEffect, useMemo, useState } from "react";
import { api, API } from "@/lib/api";
import { fmtTRY, todayISO, monthStartISO, monthEndISO, fmtDateShort } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Pencil,
  Receipt,
  Download,
  Send,
  Settings2,
  Save,
  Loader2,
  Coins,
  ListChecks,
} from "lucide-react";
import TelegramPreviewDialog from "@/components/TelegramPreviewDialog";

const EMPTY_FORM = { date: todayISO(), description: "", category: "", amount: "", note: "" };

export default function AdminPayments() {
  const [dateFrom, setDateFrom] = useState(monthStartISO());
  const [dateTo, setDateTo] = useState(monthEndISO());
  const [data, setData] = useState({ items: [], total: 0, count: 0 });
  const [loading, setLoading] = useState(true);

  // add/edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // telegram
  const [tgOpen, setTgOpen] = useState(false);
  const [tgCfgOpen, setTgCfgOpen] = useState(false);
  const [tgCfg, setTgCfg] = useState({ telegram_bot_token: "", telegram_chat_id: "", configured: false });
  const [tgSaving, setTgSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/payments", { params: { date_from: dateFrom, date_to: dateTo } });
      setData(r.data || { items: [], total: 0, count: 0 });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  const loadTgCfg = useCallback(async () => {
    try {
      const r = await api.get("/admin/payments/telegram-config");
      setTgCfg(r.data);
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTgCfg(); }, [loadTgCfg]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({
      date: row.date,
      description: row.description || "",
      category: row.category || "",
      amount: String(row.amount ?? ""),
      note: row.note || "",
    });
    setDialogOpen(true);
  };

  const submit = async () => {
    if (!form.description.trim()) return toast.error("Açıklama girin");
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return toast.error("Geçerli bir tutar girin");
    setSaving(true);
    try {
      const payload = {
        date: form.date,
        description: form.description.trim(),
        amount: amt,
        category: form.category.trim() || null,
        note: form.note.trim() || null,
      };
      if (editingId) {
        await api.put(`/admin/payments/${editingId}`, payload);
        toast.success("Ödeme güncellendi");
      } else {
        await api.post("/admin/payments", payload);
        toast.success("Ödeme eklendi");
      }
      setDialogOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kayıt hatası");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id) => {
    if (!confirm("Bu ödeme kaydı silinsin mi?")) return;
    try {
      await api.delete(`/admin/payments/${id}`);
      toast.success("Silindi");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Silinemedi");
    }
  };

  const exportCsv = async () => {
    try {
      const r = await api.get("/admin/payments/export.csv", {
        params: { date_from: dateFrom, date_to: dateTo },
        responseType: "blob",
      });
      const blob = new Blob([r.data], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `admin_odemeler_${dateFrom}_${dateTo}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      toast.error("CSV indirilemedi");
    }
  };

  const saveTgCfg = async () => {
    setTgSaving(true);
    try {
      const r = await api.put("/admin/payments/telegram-config", {
        telegram_bot_token: tgCfg.telegram_bot_token || "",
        telegram_chat_id: tgCfg.telegram_chat_id || "",
      });
      setTgCfg(r.data);
      toast.success("Telegram yapılandırması kaydedildi");
      setTgCfgOpen(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kaydedilemedi");
    } finally {
      setTgSaving(false);
    }
  };

  const previewUrl = `/admin/payments/telegram-preview?date_from=${dateFrom}&date_to=${dateTo}`;
  const sendUrl = `/admin/payments/send-telegram?date_from=${dateFrom}&date_to=${dateTo}`;

  const rangeLabel = useMemo(() => `${dateFrom} → ${dateTo}`, [dateFrom, dateTo]);

  return (
    <div className="space-y-6" data-testid="admin-payments-page">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Receipt className="w-5 h-5 text-primary" />
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Admin</div>
          <h2 className="font-display text-xl text-foreground">Ödemeler</h2>
        </div>
        <Button
          variant="outline"
          onClick={() => setTgCfgOpen(true)}
          className="rounded-sm border-border h-9 gap-2 text-xs"
          data-testid="ap-tg-config-btn"
          title="Telegram yapılandırması"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Telegram Ayarları
        </Button>
      </div>

      {/* Filter + actions */}
      <div className="border border-border rounded-sm bg-card p-4 md:p-5">
        <div className="flex items-end gap-3 flex-wrap justify-between">
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Başlangıç</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40 bg-transparent border-border rounded-sm font-data h-9"
                data-testid="ap-date-from"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Bitiş</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40 bg-transparent border-border rounded-sm font-data h-9"
                data-testid="ap-date-to"
              />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={exportCsv}
              variant="outline"
              className="rounded-sm border-border h-9 gap-2"
              data-testid="ap-export-csv"
            >
              <Download className="w-4 h-4" /> CSV
            </Button>
            <Button
              onClick={() => setTgOpen(true)}
              className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95"
              data-testid="ap-send-telegram"
            >
              <Send className="w-4 h-4" /> Telegram'a Gönder
            </Button>
            <Button
              onClick={openCreate}
              className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95"
              data-testid="ap-add-btn"
            >
              <Plus className="w-4 h-4" /> Yeni Ödeme
            </Button>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard
          icon={Coins}
          label="Dönem Toplamı"
          value={fmtTRY(data.total)}
          tone="red"
          testId="ap-kpi-total"
        />
        <KpiCard
          icon={ListChecks}
          label="Kayıt Sayısı"
          value={String(data.count)}
          tone="muted"
          testId="ap-kpi-count"
        />
        <KpiCard
          icon={Receipt}
          label="Dönem"
          value={rangeLabel}
          tone="muted"
          small
          testId="ap-kpi-range"
        />
      </div>

      {/* Table */}
      <div className="border border-border rounded-sm bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Tarih</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Açıklama</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Kategori</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Tutar</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Not</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow className="border-border">
                <TableCell colSpan={6} className="text-center text-xs text-muted-foreground font-data py-8">
                  Yükleniyor...
                </TableCell>
              </TableRow>
            )}
            {!loading && data.items.length === 0 && (
              <TableRow className="border-border">
                <TableCell colSpan={6} className="text-center text-xs text-muted-foreground font-data py-10">
                  Bu dönemde ödeme kaydı yok. "Yeni Ödeme" ile ekleyebilirsiniz.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              data.items.map((row) => (
                <TableRow key={row.id} className="border-border hover:bg-white/[0.02]" data-testid={`ap-row-${row.id}`}>
                  <TableCell className="font-data text-xs text-muted-foreground">{fmtDateShort(row.date)}</TableCell>
                  <TableCell className="text-sm text-foreground">{row.description}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.category ? (
                      <span className="inline-block border border-border rounded-sm px-2 py-0.5 text-[10px] uppercase tracking-[0.15em]">
                        {row.category}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right font-data text-sm text-[hsl(345_100%_65%)] font-medium">
                    {fmtTRY(row.amount)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">{row.note || "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(row)}
                        className="h-7 w-7 rounded-sm text-muted-foreground hover:text-foreground"
                        data-testid={`ap-edit-${row.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => del(row.id)}
                        className="h-7 w-7 rounded-sm text-muted-foreground hover:text-red-400"
                        data-testid={`ap-delete-${row.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      {/* Add/Edit dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) {
            setEditingId(null);
            setForm(EMPTY_FORM);
          }
        }}
      >
        <DialogContent className="bg-card border-border rounded-sm max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground flex items-center gap-2">
              <Receipt className="w-4 h-4 text-primary" />
              {editingId ? "Ödemeyi Düzenle" : "Yeni Ödeme"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Tarih</label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="bg-transparent border-border rounded-sm font-data h-9"
                data-testid="ap-form-date"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">
                Açıklama <span className="text-[hsl(345_100%_65%)]">*</span>
              </label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Ör. Ofis kirası, yazılım aboneliği..."
                className="bg-transparent border-border rounded-sm h-9"
                data-testid="ap-form-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">
                  Tutar (TRY) <span className="text-[hsl(345_100%_65%)]">*</span>
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0.00"
                  className="bg-transparent border-border rounded-sm h-9 font-data text-right"
                  data-testid="ap-form-amount"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">
                  Kategori
                </label>
                <Input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Ör. kira, personel, yazılım..."
                  className="bg-transparent border-border rounded-sm h-9"
                  data-testid="ap-form-category"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Not</label>
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Opsiyonel açıklama"
                className="bg-transparent border-border rounded-sm h-9"
                data-testid="ap-form-note"
              />
            </div>
          </div>
          <DialogFooter className="flex flex-row justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="rounded-sm border border-border h-9"
              data-testid="ap-form-cancel"
            >
              İptal
            </Button>
            <Button
              onClick={submit}
              disabled={saving}
              className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95 disabled:opacity-60"
              data-testid="ap-form-submit"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {editingId ? "Güncelle" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Telegram config dialog */}
      <Dialog open={tgCfgOpen} onOpenChange={setTgCfgOpen}>
        <DialogContent className="bg-card border-border rounded-sm max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-primary" /> Admin Ödemeler — Telegram Ayarları
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Bu bot Ödemeler sayfasındaki dönem özetini istediğiniz Telegram grubuna gönderir. Site bazlı Telegram ayarından bağımsızdır.
            </p>
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">
                Bot Token
              </label>
              <Input
                value={tgCfg.telegram_bot_token || ""}
                onChange={(e) => setTgCfg({ ...tgCfg, telegram_bot_token: e.target.value })}
                placeholder="123456789:ABC-DEF..."
                className="bg-transparent border-border rounded-sm h-9 font-data text-xs"
                data-testid="ap-tg-token"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">
                Chat / Grup ID
              </label>
              <Input
                value={tgCfg.telegram_chat_id || ""}
                onChange={(e) => setTgCfg({ ...tgCfg, telegram_chat_id: e.target.value })}
                placeholder="-1001234567890"
                className="bg-transparent border-border rounded-sm h-9 font-data text-xs"
                data-testid="ap-tg-chat"
              />
            </div>
            <div className="text-[10px] text-muted-foreground">
              Durum:{" "}
              {tgCfg.configured ? (
                <span className="text-[hsl(144_100%_55%)] font-medium">Yapılandırıldı</span>
              ) : (
                <span className="text-[hsl(45_100%_55%)] font-medium">Eksik</span>
              )}
            </div>
          </div>
          <DialogFooter className="flex flex-row justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setTgCfgOpen(false)}
              disabled={tgSaving}
              className="rounded-sm border border-border h-9"
              data-testid="ap-tg-cancel"
            >
              İptal
            </Button>
            <Button
              onClick={saveTgCfg}
              disabled={tgSaving}
              className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95 disabled:opacity-60"
              data-testid="ap-tg-save"
            >
              {tgSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Telegram preview + send */}
      <TelegramPreviewDialog
        open={tgOpen}
        onOpenChange={setTgOpen}
        title={`Ödemeler (${dateFrom} → ${dateTo}) — Telegram Önizleme`}
        previewUrl={previewUrl}
        sendUrl={sendUrl}
      />
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone, small, testId }) {
  const toneCls =
    tone === "red"
      ? "text-[hsl(345_100%_65%)] glow-red"
      : tone === "green"
      ? "text-[hsl(144_100%_55%)] glow-green"
      : "text-foreground";
  const valSize = small ? "text-sm font-data" : "text-2xl font-light font-data tracking-tight";
  return (
    <div className="border border-border rounded-sm bg-card p-4" data-testid={testId}>
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon className="w-3.5 h-3.5 text-primary" />}
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
      </div>
      <div className={`${valSize} ${toneCls}`}>{value}</div>
    </div>
  );
}

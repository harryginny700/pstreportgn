import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Bot, Save, Loader2, Play, Plus, Trash2, ChevronDown, ChevronRight,
  KeyRound, Link2, CheckCircle2, XCircle, MinusCircle, RefreshCw, Calendar, Zap,
  CalendarRange,
} from "lucide-react";

function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("tr-TR"); } catch { return iso; }
}

function StatusPill({ status }) {
  if (status === "success") return (
    <span className="inline-flex items-center gap-1 text-[hsl(144_100%_55%)] text-[11px]">
      <CheckCircle2 className="w-3 h-3" /> Başarılı
    </span>
  );
  if (status === "failed") return (
    <span className="inline-flex items-center gap-1 text-[hsl(345_100%_65%)] text-[11px]">
      <XCircle className="w-3 h-3" /> Hata
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground text-[11px]">
      <MinusCircle className="w-3 h-3" /> Hiç çalışmadı
    </span>
  );
}

export default function AdminScraper() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null); // full config detail per site
  const [paymentMethods, setPaymentMethods] = useState({}); // by site_id
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [runDateOpen, setRunDateOpen] = useState(false);
  const [runDate, setRunDate] = useState("");
  const [runResult, setRunResult] = useState(null);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillStart, setBackfillStart] = useState("2026-08-01");
  const [backfillEnd, setBackfillEnd] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/scraper");
      setItems(r.data || []);
    } catch (e) {
      toast.error("Konfigürasyonlar yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openSite = async (siteId) => {
    if (expanded === siteId) { setExpanded(null); return; }
    setExpanded(siteId);
    try {
      const [cfg, pm] = await Promise.all([
        api.get(`/admin/scraper/${siteId}`),
        api.get(`/payment-methods`, { params: { site_id: siteId } }),
      ]);
      setDetail({ ...cfg.data, _password_input: "" });
      setPaymentMethods((p) => ({ ...p, [siteId]: pm.data || [] }));
    } catch (e) {
      toast.error("Detay yüklenemedi");
      setExpanded(null);
    }
  };

  const patch = (patch) => setDetail((d) => ({ ...d, ...patch }));

  const addMapping = () => {
    const first = (paymentMethods[detail.site_id] || [])[0];
    if (!first) return toast.error("Önce bu site için ödeme yöntemi ekleyin");
    patch({ mappings: [...(detail.mappings || []), { provider: "", method: "", payment_method_id: first.id }] });
  };

  const updateMapping = (idx, key, value) => {
    const next = [...(detail.mappings || [])];
    next[idx] = { ...next[idx], [key]: value };
    patch({ mappings: next });
  };

  const removeMapping = (idx) => {
    const next = [...(detail.mappings || [])];
    next.splice(idx, 1);
    patch({ mappings: next });
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        enabled: !!detail.enabled,
        base_url: detail.base_url || "",
        username: detail.username || "",
        deposits_path: detail.deposits_path || "",
        withdrawals_path: detail.withdrawals_path || "",
        mappings: (detail.mappings || []).map((m) => ({
          provider: (m.provider || "").trim(),
          method: (m.method || "").trim(),
          payment_method_id: m.payment_method_id,
        })).filter((m) => m.provider && m.method && m.payment_method_id),
      };
      if (detail._password_input) body.password = detail._password_input;
      const r = await api.put(`/admin/scraper/${detail.site_id}`, body);
      setDetail({ ...r.data, _password_input: "" });
      toast.success("Ayarlar kaydedildi");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  const openRun = () => {
    // default to yesterday
    const d = new Date();
    d.setDate(d.getDate() - 1);
    setRunDate(d.toISOString().slice(0, 10));
    setRunResult(null);
    setRunDateOpen(true);
  };

  const runNow = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const r = await api.post(`/admin/scraper/${detail.site_id}/run`, { target_date: runDate });
      setRunResult(r.data);
      if (r.data?.ok) toast.success(`Scrape başarılı — ${r.data.row_count || 0} satır`);
      else toast.error(`Scrape başarısız: ${r.data?.error || "bilinmeyen"}`);
      await load();
      const cfg = await api.get(`/admin/scraper/${detail.site_id}`);
      setDetail({ ...cfg.data, _password_input: "" });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Çalıştırılamadı");
    } finally {
      setRunning(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.post(`/admin/scraper/${detail.site_id}/test-connection`);
      setTestResult(r.data);
      if (r.data?.ok) toast.success("Bağlantı başarılı — login yapıldı ✓");
      else toast.error(`Bağlantı başarısız: ${r.data?.message || "bilinmeyen"}`);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Test başarısız";
      setTestResult({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  const openBackfill = () => {
    // Default end = yesterday
    const d = new Date();
    d.setDate(d.getDate() - 1);
    setBackfillEnd(d.toISOString().slice(0, 10));
    setBackfillResult(null);
    setBackfillOpen(true);
  };

  const runBackfill = async () => {
    if (!backfillStart || !backfillEnd) return toast.error("Başlangıç ve bitiş tarihi seçin");
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const r = await api.post(`/admin/scraper/${detail.site_id}/backfill`, {
        start_date: backfillStart,
        end_date: backfillEnd,
      }, { timeout: 15 * 60 * 1000 }); // 15 min for large ranges
      setBackfillResult(r.data);
      if (r.data?.fail_count === 0) toast.success(`Toplu çekim tamam: ${r.data.days} gün başarılı`);
      else toast.warning(`${r.data.ok_count}/${r.data.days} gün başarılı — ${r.data.fail_count} gün hatalı`);
      await load();
      const cfg = await api.get(`/admin/scraper/${detail.site_id}`);
      setDetail({ ...cfg.data, _password_input: "" });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Toplu çekim başarısız");
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-scraper-page">
      <div className="flex items-center gap-3">
        <Bot className="w-5 h-5 text-primary" />
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Admin</div>
          <h2 className="font-display text-xl text-foreground">Otomatik Veri Çekme (Scraper)</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={load} className="h-8 rounded-sm border border-border gap-1 text-xs" data-testid="scraper-refresh">
          <RefreshCw className="w-3 h-3" /> Yenile
        </Button>
      </div>

      <div className="border border-border rounded-sm bg-card p-4 text-xs text-muted-foreground">
        Her gün <span className="text-foreground font-data">01:00 TR</span> saatinde etkin sitelerin bir önceki günün <span className="text-foreground">Yatırım/Çekim</span> işlemleri
        (`Durum = Tamamlandı`) kaynak backoffice'ten çekilip Günlük Giriş tablosuna işlenir. Telegram bildirimi otomatik gönderilir.
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-6">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Yükleniyor...
        </div>
      ) : (
        <div className="border border-border rounded-sm bg-card overflow-hidden">
          {items.map((it, idx) => {
            const isOpen = expanded === it.site_id;
            return (
              <div key={it.site_id} className={`border-b border-border ${idx === items.length - 1 ? "border-b-0" : ""}`} data-testid={`scraper-row-${it.site_id}`}>
                <button
                  onClick={() => openSite(it.site_id)}
                  className="w-full px-5 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  <div className="flex-1 text-left">
                    <div className="text-sm text-foreground">{it.site_name}</div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {it.enabled ? <span className="text-[hsl(144_100%_55%)]">Aktif</span> : "Pasif"}
                      {" · "}
                      {it.base_url ? <span className="lowercase font-data normal-case">{it.base_url}</span> : "URL yok"}
                    </div>
                  </div>
                  <div className="hidden md:flex flex-col items-end text-[11px] text-muted-foreground">
                    <StatusPill status={it.last_run_status} />
                    {it.last_run_at && <span className="font-data">{fmtDate(it.last_run_at)}</span>}
                  </div>
                </button>

                {isOpen && detail && detail.site_id === it.site_id && (
                  <div className="px-5 pb-5 space-y-4 border-t border-border/60 bg-white/[0.01]">
                    {/* Enable + URL + Auth */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                      <div className="border border-border rounded-sm bg-card p-4 space-y-3">
                        <div className="text-xs font-medium text-foreground flex items-center gap-2">
                          <Link2 className="w-3.5 h-3.5 text-primary" /> Kaynak Sağlayıcı
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm text-foreground">Otomatik Çekim</div>
                            <div className="text-[11px] text-muted-foreground">Aktif olduğunda gecelik cron çalıştırır.</div>
                          </div>
                          <Switch
                            checked={!!detail.enabled}
                            onCheckedChange={(v) => patch({ enabled: v })}
                            data-testid="scraper-enabled"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Base URL</label>
                          <Input value={detail.base_url || ""} onChange={(e) => patch({ base_url: e.target.value })} placeholder="https://backoffice.playspintech.com" className="bg-transparent border-border rounded-sm h-9 font-data text-xs" data-testid="scraper-base-url" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Yatırımlar Path</label>
                            <Input value={detail.deposits_path || ""} onChange={(e) => patch({ deposits_path: e.target.value })} placeholder="/transactions/deposits" className="bg-transparent border-border rounded-sm h-9 font-data text-xs" data-testid="scraper-deposits-path" />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Çekimler Path</label>
                            <Input value={detail.withdrawals_path || ""} onChange={(e) => patch({ withdrawals_path: e.target.value })} placeholder="/transactions/withdrawals" className="bg-transparent border-border rounded-sm h-9 font-data text-xs" data-testid="scraper-withdrawals-path" />
                          </div>
                        </div>
                      </div>

                      <div className="border border-border rounded-sm bg-card p-4 space-y-3">
                        <div className="text-xs font-medium text-foreground flex items-center gap-2">
                          <KeyRound className="w-3.5 h-3.5 text-primary" /> Kimlik Bilgileri (şifreli saklanır)
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Kullanıcı Adı</label>
                          <Input value={detail.username || ""} onChange={(e) => patch({ username: e.target.value })} placeholder="admin" className="bg-transparent border-border rounded-sm h-9 font-data text-xs" data-testid="scraper-username" />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">
                            Şifre {detail.password_set && <span className="text-[hsl(144_100%_55%)] normal-case tracking-normal">(kayıtlı — değiştirmek için yeni değer girin)</span>}
                          </label>
                          <Input
                            type="password"
                            value={detail._password_input || ""}
                            onChange={(e) => patch({ _password_input: e.target.value })}
                            placeholder={detail.password_set ? "••••••••" : "Şifreyi girin"}
                            className="bg-transparent border-border rounded-sm h-9 font-data text-xs"
                            data-testid="scraper-password"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Mapping table */}
                    <div className="border border-border rounded-sm bg-card">
                      <div className="p-4 border-b border-border flex items-center justify-between">
                        <div className="text-xs font-medium text-foreground">Sağlayıcı × Yöntem → Ödeme Yöntemi Eşlemesi</div>
                        <Button size="sm" onClick={addMapping} className="h-7 rounded-sm bg-primary text-primary-foreground gap-1 text-xs" data-testid="scraper-add-mapping">
                          <Plus className="w-3 h-3" /> Eşleme Ekle
                        </Button>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border hover:bg-transparent">
                            <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Sağlayıcı (kaynak)</TableHead>
                            <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Yöntem (kaynak)</TableHead>
                            <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">→ Ödeme Yöntemi (bizde)</TableHead>
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(detail.mappings || []).length === 0 && (
                            <TableRow className="border-border"><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-4">Eşleme yok — "Eşleme Ekle" ile başlayın.</TableCell></TableRow>
                          )}
                          {(detail.mappings || []).map((m, idx) => (
                            <TableRow key={idx} className="border-border" data-testid={`scraper-mapping-${idx}`}>
                              <TableCell>
                                <Input value={m.provider || ""} onChange={(e) => updateMapping(idx, "provider", e.target.value)} placeholder="Bigpayss" className="bg-transparent border-border rounded-sm h-8 font-data text-xs" data-testid={`scraper-mapping-provider-${idx}`} />
                              </TableCell>
                              <TableCell>
                                <Input value={m.method || ""} onChange={(e) => updateMapping(idx, "method", e.target.value)} placeholder="Havale/EFT" className="bg-transparent border-border rounded-sm h-8 font-data text-xs" data-testid={`scraper-mapping-method-${idx}`} />
                              </TableCell>
                              <TableCell>
                                <Select value={m.payment_method_id} onValueChange={(v) => updateMapping(idx, "payment_method_id", v)}>
                                  <SelectTrigger className="bg-transparent border-border rounded-sm h-8 text-xs" data-testid={`scraper-mapping-pm-${idx}`}>
                                    <SelectValue placeholder="Seç" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(paymentMethods[detail.site_id] || []).map((p) => (
                                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon" onClick={() => removeMapping(idx)} className="h-7 w-7 rounded-sm hover:text-[hsl(345_100%_65%)]" data-testid={`scraper-mapping-remove-${idx}`}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Last run summary */}
                    {detail.last_run_summary && (
                      <div className="border border-border rounded-sm bg-card p-4 text-xs">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium text-foreground">Son Çalıştırma</div>
                          <div className="flex items-center gap-3">
                            <StatusPill status={detail.last_run_status} />
                            <span className="text-muted-foreground font-data">{fmtDate(detail.last_run_at)}</span>
                          </div>
                        </div>
                        {detail.last_run_error && (
                          <div className="text-[hsl(345_100%_65%)] font-data text-[11px]" data-testid="scraper-last-error">Hata: {detail.last_run_error}</div>
                        )}
                        {detail.last_run_summary?.debug_screenshot && (
                          <a
                            href={`${process.env.REACT_APP_BACKEND_URL}/api/admin/scraper/debug/${detail.last_run_summary.debug_screenshot}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline text-[11px] block mt-1"
                          >
                            Debug ekran görüntüsünü aç →
                          </a>
                        )}
                        {detail.last_run_summary?.applied?.length > 0 && (
                          <ul className="mt-2 space-y-0.5 text-muted-foreground">
                            {detail.last_run_summary.applied.map((a, i) => (
                              <li key={i}>
                                <span className="text-foreground">{a.payment_method_name}</span>: Y ₺{a.deposit?.toLocaleString("tr-TR")} · Ç ₺{a.withdrawal?.toLocaleString("tr-TR")} · Kom ₺{a.commission?.toLocaleString("tr-TR")} · Net ₺{a.net?.toLocaleString("tr-TR")}
                              </li>
                            ))}
                          </ul>
                        )}
                        {detail.last_run_summary?.unmapped?.length > 0 && (
                          <div className="mt-2">
                            <div className="text-[hsl(45_100%_60%)] mb-1">Eşlenmemiş kaynaklar (Günlük Giriş'e YAZILMADI):</div>
                            <ul className="space-y-0.5 text-muted-foreground">
                              {detail.last_run_summary.unmapped.map((u, i) => (
                                <li key={i}>· {u.provider} · {u.method} ({u.tur}) → ₺{u.amount?.toLocaleString("tr-TR")}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 justify-end pt-2">
                      <Button
                        onClick={testConnection}
                        disabled={testing || !detail.password_set}
                        variant="outline"
                        className="rounded-sm border-border h-9 gap-2 disabled:opacity-40"
                        title={!detail.password_set ? "Önce şifreyi kaydet" : "Sadece login denemesi yap"}
                        data-testid="scraper-test-connection"
                      >
                        {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />} Bağlantı Testi
                      </Button>
                      <Button onClick={openRun} variant="outline" className="rounded-sm border-border h-9 gap-2" disabled={!detail.enabled || (!detail.password_set && !detail._password_input)} data-testid="scraper-run-now">
                        <Play className="w-3.5 h-3.5" /> Şimdi Çek
                      </Button>
                      <Button onClick={openBackfill} variant="outline" className="rounded-sm border-border h-9 gap-2" disabled={!detail.enabled || (!detail.password_set && !detail._password_input)} data-testid="scraper-backfill">
                        <CalendarRange className="w-3.5 h-3.5" /> Toplu Çekim
                      </Button>
                      <Button onClick={save} disabled={saving} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2" data-testid="scraper-save">
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Kaydet
                      </Button>
                    </div>

                    {/* Test result panel */}
                    {testResult && (
                      <div className="border border-border rounded-sm bg-card p-4 text-xs" data-testid="scraper-test-result">
                        {testResult.ok ? (
                          <div>
                            <div className="text-[hsl(144_100%_55%)] mb-1 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> {testResult.message}</div>
                            {testResult.landing_url && <div className="text-muted-foreground font-data text-[11px]">Landed on: {testResult.landing_url}</div>}
                          </div>
                        ) : (
                          <div>
                            <div className="text-[hsl(345_100%_65%)] mb-2 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> {testResult.message}</div>
                            {testResult.debug_screenshot && (
                              <a
                                href={`${process.env.REACT_APP_BACKEND_URL}/api/admin/scraper/debug/${testResult.debug_screenshot}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary underline text-[11px]"
                                data-testid="scraper-debug-link"
                              >
                                Debug ekran görüntüsünü aç →
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Manual Run Dialog */}
      <Dialog open={runDateOpen} onOpenChange={setRunDateOpen}>
        <DialogContent className="bg-card border-border rounded-sm max-w-md" data-testid="scraper-run-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground flex items-center gap-2">
              <Play className="w-4 h-4 text-primary" /> Manuel Çekim — {items.find((i) => i.site_id === detail?.site_id)?.site_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5 flex items-center gap-2"><Calendar className="w-3 h-3" /> Hangi gün?</label>
              <Input type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} className="bg-transparent border-border rounded-sm h-9 font-data" data-testid="scraper-run-date" />
              <p className="text-[10px] text-muted-foreground mt-1.5">Kaynak sitede login olur, o günün Tamamlandı transaksiyonlarını çeker, Günlük Giriş tablosunu günceller.</p>
            </div>
            {runResult && (
              <div className="border border-border rounded-sm bg-background p-3 text-xs">
                {runResult.ok ? (
                  <div>
                    <div className="text-[hsl(144_100%_55%)] mb-1">✓ Başarılı — {runResult.row_count} satır işlendi</div>
                    <ul className="text-muted-foreground space-y-0.5">
                      {(runResult.applied || []).map((a, i) => (
                        <li key={i}>{a.payment_method_name}: Y ₺{a.deposit?.toLocaleString("tr-TR")} · Ç ₺{a.withdrawal?.toLocaleString("tr-TR")}</li>
                      ))}
                    </ul>
                    {runResult.unmapped?.length > 0 && (
                      <div className="mt-2 text-[hsl(45_100%_60%)]">
                        Eşlenmemiş: {runResult.unmapped.length} kaynak (aşağıda listelendi)
                        <ul className="text-muted-foreground">
                          {runResult.unmapped.map((u, i) => <li key={i}>· {u.provider}/{u.method} ({u.tur}) ₺{u.amount}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="text-[hsl(345_100%_65%)] mb-2">✗ {runResult.error}</div>
                    {runResult.debug_screenshot && (
                      <a
                        href={`${process.env.REACT_APP_BACKEND_URL}/api/admin/scraper/debug/${runResult.debug_screenshot}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline"
                      >
                        Debug ekran görüntüsünü aç →
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="flex flex-row justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setRunDateOpen(false)} disabled={running} className="rounded-sm border border-border h-9">Kapat</Button>
            <Button onClick={runNow} disabled={running || !runDate} className="rounded-sm bg-primary text-primary-foreground h-9 gap-2" data-testid="scraper-run-confirm">
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Çalıştır
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Backfill (bulk range) Dialog */}
      <Dialog open={backfillOpen} onOpenChange={setBackfillOpen}>
        <DialogContent className="bg-card border-border rounded-sm max-w-lg" data-testid="scraper-backfill-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground flex items-center gap-2">
              <CalendarRange className="w-4 h-4 text-primary" /> Toplu Çekim — {items.find((i) => i.site_id === detail?.site_id)?.site_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Belirlediğin tarih aralığındaki her gün için kaynak siteye login olunur, o günün Tamamlandı transaksiyonları çekilip Günlük Giriş tablosuna işlenir. Maksimum 62 gün. Aralık büyükse birkaç dakika sürebilir.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5 flex items-center gap-1"><Calendar className="w-3 h-3" /> Başlangıç</label>
                <Input type="date" value={backfillStart} onChange={(e) => setBackfillStart(e.target.value)} className="bg-transparent border-border rounded-sm h-9 font-data" data-testid="scraper-backfill-start" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5 flex items-center gap-1"><Calendar className="w-3 h-3" /> Bitiş</label>
                <Input type="date" value={backfillEnd} onChange={(e) => setBackfillEnd(e.target.value)} className="bg-transparent border-border rounded-sm h-9 font-data" data-testid="scraper-backfill-end" />
              </div>
            </div>
            {backfillResult && (
              <div className="border border-border rounded-sm bg-background p-3 text-xs max-h-64 overflow-auto" data-testid="scraper-backfill-result">
                <div className="mb-2">
                  <span className="text-[hsl(144_100%_55%)]">{backfillResult.ok_count}</span>
                  <span className="text-muted-foreground"> / {backfillResult.days} gün başarılı</span>
                  {backfillResult.fail_count > 0 && <span className="text-[hsl(345_100%_65%)]"> · {backfillResult.fail_count} hata</span>}
                </div>
                <div className="space-y-0.5 font-data">
                  {(backfillResult.results || []).map((r) => (
                    <div key={r.date} className="flex items-center gap-2 flex-wrap">
                      <span className="text-muted-foreground w-24">{r.date}</span>
                      {r.ok ? (
                        <>
                          <span className={r.row_count > 0 ? "text-[hsl(144_100%_55%)] text-[11px]" : "text-[hsl(45_100%_60%)] text-[11px]"}>
                            {r.row_count > 0 ? `✓ ${r.row_count} satır` : `⚠ 0 satır bulundu`}
                          </span>
                          {r.diagnostics && (
                            <>
                              <span className="text-muted-foreground text-[10px]" title={JSON.stringify(r.diagnostics, null, 2)}>
                                (Y: {r.diagnostics.deposits?.total_seen ?? 0} tarandı, en eski {r.diagnostics.deposits?.oldest_date ?? '—'} · Ç: {r.diagnostics.withdrawals?.total_seen ?? 0}, en eski {r.diagnostics.withdrawals?.oldest_date ?? '—'})
                              </span>
                              {r.diagnostics.deposits?.headers && (
                                <details className="w-full mt-1">
                                  <summary className="text-[10px] text-primary cursor-pointer">Tablo yapısı (debug)</summary>
                                  <div className="text-[10px] text-muted-foreground font-data mt-1 space-y-1">
                                    <div><span className="text-foreground">Kolonlar (Yatırım):</span> {(r.diagnostics.deposits.headers || []).join(" | ")}</div>
                                    <div><span className="text-foreground">Column map:</span> {JSON.stringify(r.diagnostics.deposits.column_map)}</div>
                                    {(r.diagnostics.deposits.sample_rows || []).slice(0, 2).map((row, i) => (
                                      <div key={i}><span className="text-foreground">Satır #{i+1}:</span> {(row || []).map((c, j) => `[${j}]${c}`).join(" | ")}</div>
                                    ))}
                                  </div>
                                </details>
                              )}
                            </>
                          )}
                          {r.debug_screenshot && (
                            <a
                              href={`${process.env.REACT_APP_BACKEND_URL}/api/admin/scraper/debug/${r.debug_screenshot}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary underline text-[10px]"
                            >
                              screenshot
                            </a>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="text-[hsl(345_100%_65%)] text-[11px]">✗ {r.error}</span>
                          {r.debug_screenshot && (
                            <a
                              href={`${process.env.REACT_APP_BACKEND_URL}/api/admin/scraper/debug/${r.debug_screenshot}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary underline text-[10px]"
                            >
                              screenshot
                            </a>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="flex flex-row justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setBackfillOpen(false)} disabled={backfilling} className="rounded-sm border border-border h-9">Kapat</Button>
            <Button onClick={runBackfill} disabled={backfilling || !backfillStart || !backfillEnd} className="rounded-sm bg-primary text-primary-foreground h-9 gap-2" data-testid="scraper-backfill-confirm">
              {backfilling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarRange className="w-3.5 h-3.5" />} Aralığı Çek
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

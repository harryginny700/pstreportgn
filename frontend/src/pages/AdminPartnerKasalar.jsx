import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Wallet, MinusCircle, Loader2, TrendingUp, TrendingDown, ExternalLink, Send } from "lucide-react";

const PARTNERS = ["Playspintech", "Harry", "Bozo", "Memo"];

export default function AdminPartnerKasalar() {
  const [kasalar, setKasalar] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [movements, setMovements] = useState({});
  const [wdOpen, setWdOpen] = useState(false);
  const [wdKasa, setWdKasa] = useState(null);
  const [wdForm, setWdForm] = useState({ amount: "", date: "", note: "" });
  const [wdBusy, setWdBusy] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/partner-kasalar");
      setKasalar(r.data || []);
    } catch (e) {
      toast.error("Yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  const sendSummary = async () => {
    setSending(true);
    try {
      const r = await api.post("/admin/notifications/send-partner-summary");
      if (r.data?.ok) toast.success("Ortak Kasa özeti Telegram'a gönderildi ✓");
      else if (r.data?.error === "disabled") toast.warning("Ortak Kasa bildirimi kapalı — Bot Ayarları'ndan açın");
      else if (r.data?.error === "not_configured") toast.warning("Bot yapılandırılmamış — Bot Ayarları sayfasından ekleyin");
      else toast.error(`Gönderilemedi: ${r.data?.error || "bilinmeyen"}`);
    } catch (e) { toast.error("Gönderim başarısız"); }
    finally { setSending(false); }
  };

  const loadMovements = async (name) => {
    try {
      const r = await api.get(`/admin/partner-kasalar/${encodeURIComponent(name)}/movements`);
      setMovements(m => ({ ...m, [name]: r.data || [] }));
    } catch (e) {
      toast.error("Hareketler yüklenemedi");
    }
  };

  const toggle = async (name) => {
    if (expanded === name) { setExpanded(null); return; }
    setExpanded(name);
    if (!movements[name]) await loadMovements(name);
  };

  const openWithdraw = (name) => {
    setWdKasa(name);
    setWdForm({ amount: "", date: new Date().toISOString().slice(0, 10), note: "" });
    setWdOpen(true);
  };

  const submitWithdraw = async () => {
    const amt = parseFloat(wdForm.amount);
    if (isNaN(amt) || amt <= 0) return toast.error("Geçerli tutar girin");
    setWdBusy(true);
    try {
      await api.post(`/admin/partner-kasalar/${encodeURIComponent(wdKasa)}/withdraw`, {
        amount: amt,
        date: wdForm.date || null,
        note: wdForm.note || null,
      });
      toast.success(`${wdKasa} kasasından ₺${amt.toLocaleString("tr-TR")} çekildi`);
      setWdOpen(false);
      await load();
      if (expanded === wdKasa) await loadMovements(wdKasa);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "İşlem başarısız");
    } finally {
      setWdBusy(false);
    }
  };

  useEffect(() => { load(); }, [load]);

  const totalBalance = useMemo(() => kasalar.reduce((a, b) => a + (b.balance || 0), 0), [kasalar]);

  useEffect(() => {}, []);

  return (
    <div className="space-y-6" data-testid="admin-partner-kasalar-page">
      <div className="border border-border rounded-sm bg-card p-6 flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2">Toplam Ortak Kasa Bakiyesi</div>
          <div className={`font-data text-4xl font-light tracking-tight ${totalBalance >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`} data-testid="pk-total-balance">
            {fmtTRY(totalBalance)}
          </div>
        </div>
        <Button
          onClick={sendSummary}
          disabled={sending}
          variant="outline"
          className="rounded-sm border-border h-9 gap-2"
          data-testid="pk-send-summary"
          title="Ortak Kasa bakiyelerini admin Telegram grubuna gönder"
        >
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Telegram'a Özet Gönder
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {(loading ? PARTNERS.map(n => ({ name: n, balance: 0, total_deposits: 0, total_withdrawals: 0, movement_count: 0 })) : kasalar).map(k => (
          <div key={k.name} className={`border rounded-sm bg-card p-4 space-y-3 ${expanded === k.name ? "border-primary" : "border-border"}`} data-testid={`pk-card-${k.name}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-sm flex items-center justify-center ${k.name === "Playspintech" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>
                  <Wallet className="w-4 h-4" strokeWidth={2.5} />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Ortak Kasa</div>
                  <div className="font-display text-base text-foreground">{k.name}</div>
                </div>
              </div>
            </div>
            <div className={`font-data text-2xl ${k.balance >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`} data-testid={`pk-balance-${k.name}`}>{fmtTRY(k.balance)}</div>
            <div className="grid grid-cols-2 gap-2 text-xs font-data">
              <div className="border border-border rounded-sm p-2">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Giriş</div>
                <div className="text-[hsl(144_100%_55%)]">{fmtTRY(k.total_deposits)}</div>
              </div>
              <div className="border border-border rounded-sm p-2">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground flex items-center gap-1"><TrendingDown className="w-3 h-3" /> Çıkış</div>
                <div className="text-[hsl(345_100%_65%)]">{fmtTRY(k.total_withdrawals)}</div>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="ghost" onClick={() => toggle(k.name)} className="flex-1 h-8 rounded-sm text-xs border border-border" data-testid={`pk-expand-${k.name}`}>
                <ExternalLink className="w-3 h-3 mr-1" /> {expanded === k.name ? "Gizle" : "Hareketler"}
              </Button>
              <Button size="sm" onClick={() => openWithdraw(k.name)} disabled={k.balance <= 0} className="h-8 rounded-sm text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40" data-testid={`pk-withdraw-${k.name}`}>
                <MinusCircle className="w-3 h-3 mr-1" /> Para Çek
              </Button>
            </div>
          </div>
        ))}
      </div>

      {expanded && (
        <div className="border border-border rounded-sm bg-card overflow-x-auto" data-testid="pk-movements-panel">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Hareket Geçmişi</div>
              <h3 className="font-display text-lg text-foreground">{expanded} Kasa</h3>
            </div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-data">{(movements[expanded] || []).length} hareket</div>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Tarih</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Tür</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Site</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Tutar</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Not</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(movements[expanded] || []).length === 0 && (
                <TableRow className="border-border"><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">Hareket yok</TableCell></TableRow>
              )}
              {(movements[expanded] || []).map(m => (
                <TableRow key={m.id} className="border-border">
                  <TableCell className="font-data text-xs text-foreground">{m.date}</TableCell>
                  <TableCell className="text-xs">
                    {m.type === "credit_payment" && <span className="text-[hsl(144_100%_55%)]">Kredi Ödemesi</span>}
                    {m.type === "withdrawal" && <span className="text-[hsl(345_100%_65%)]">Çekim</span>}
                    {m.type === "backfill" && <span className="text-muted-foreground">Geçmiş Aktarım</span>}
                    {m.type === "adjustment" && <span className="text-muted-foreground">Düzeltme</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.site_name || "—"}</TableCell>
                  <TableCell className={`text-right font-data text-sm ${m.amount >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`}>
                    {m.amount >= 0 ? "+" : ""}{fmtTRY(m.amount)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">{m.note || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Withdraw dialog */}
      <Dialog open={wdOpen} onOpenChange={setWdOpen}>
        <DialogContent className="bg-card border-border rounded-sm max-w-sm" data-testid="pk-withdraw-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Para Çek — {wdKasa}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Tutar (₺)</label>
              <Input type="number" step="0.01" value={wdForm.amount} onChange={(e) => setWdForm({ ...wdForm, amount: e.target.value })} className="bg-transparent border-border rounded-sm h-9" autoFocus data-testid="pk-wd-amount" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Tarih</label>
              <Input type="date" value={wdForm.date} onChange={(e) => setWdForm({ ...wdForm, date: e.target.value })} className="bg-transparent border-border rounded-sm h-9 font-data" data-testid="pk-wd-date" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Not (opsiyonel)</label>
              <Input value={wdForm.note} onChange={(e) => setWdForm({ ...wdForm, note: e.target.value })} className="bg-transparent border-border rounded-sm h-9" data-testid="pk-wd-note" />
            </div>
          </div>
          <DialogFooter className="flex flex-row justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setWdOpen(false)} disabled={wdBusy} className="rounded-sm border border-border h-9">İptal</Button>
            <Button onClick={submitWithdraw} disabled={wdBusy} className="rounded-sm bg-primary text-primary-foreground h-9 gap-2" data-testid="pk-wd-save">
              {wdBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MinusCircle className="w-3.5 h-3.5" />}
              Çekimi Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

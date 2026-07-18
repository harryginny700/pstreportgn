import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Archive, ChevronRight, Landmark, Users, TrendingUp, TrendingDown, Percent, Receipt, Wallet, Coins, X } from "lucide-react";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

export default function Rollovers() {
  const [rollovers, setRollovers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/rollovers");
      setRollovers(r.data);
    } catch (e) { toast.error("Yüklenemedi"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id) => {
    try {
      const r = await api.get(`/rollovers/${id}`);
      setSelected(r.data);
    } catch (e) { toast.error("Detay alınamadı"); }
  };

  const fmtMonth = (r) => `${MONTHS[r.month - 1]} ${r.year}`;
  const fmtDt = (iso) => new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-6" data-testid="rollovers-page">
      <div className="flex items-center gap-3">
        <Archive className="w-5 h-5 text-primary" />
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Arşiv</div>
          <h2 className="font-display text-xl text-foreground">Aylık Devirler</h2>
        </div>
      </div>

      <div className="border border-border rounded-sm bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Ay</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Toplam Yatırım</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Toplam Çekim</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Komisyon</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Gider</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Kar/Zarar</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Devreden Nakit</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Kapatan</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow className="border-border"><TableCell colSpan={9} className="text-center text-xs text-muted-foreground font-data py-8">Yükleniyor...</TableCell></TableRow>
            )}
            {!loading && rollovers.length === 0 && (
              <TableRow className="border-border"><TableCell colSpan={9} className="text-center text-xs text-muted-foreground font-data py-8">Henüz devir alınmamış. Raporlar sayfasından bir ay seçip "Aylık Devir Yap" butonuna basarak başlayabilirsiniz.</TableCell></TableRow>
            )}
            {rollovers.map((r) => (
              <TableRow key={r.id} className="border-border hover:bg-white/[0.02] cursor-pointer" onClick={() => openDetail(r.id)} data-testid={`rollover-row-${r.year}-${r.month}`}>
                <TableCell className="font-medium text-foreground text-sm">{fmtMonth(r)}</TableCell>
                <TableCell className="text-right font-data text-sm text-[hsl(144_100%_55%)]">{fmtTRY(r.summary.deposit)}</TableCell>
                <TableCell className="text-right font-data text-sm text-[hsl(345_100%_65%)]">{fmtTRY(r.summary.withdrawal)}</TableCell>
                <TableCell className="text-right font-data text-sm text-[hsl(53_98%_60%)]">{fmtTRY(r.summary.commission)}</TableCell>
                <TableCell className="text-right font-data text-sm text-[hsl(345_100%_65%)]">{fmtTRY(r.summary.expense)}</TableCell>
                <TableCell className={`text-right font-data text-sm font-medium ${r.summary.profit_loss >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`}>{fmtTRY(r.summary.profit_loss)}</TableCell>
                <TableCell className={`text-right font-data text-sm ${r.total_cash_at_close >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`}>{fmtTRY(r.total_cash_at_close)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDt(r.closed_at)} · {r.closed_by_email}</TableCell>
                <TableCell><ChevronRight className="w-4 h-4 text-muted-foreground" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="bg-card border-border rounded-sm max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground flex items-center gap-2">
              <Archive className="w-4 h-4 text-primary" />
              {selected && fmtMonth(selected)} — Devir Detayı
            </DialogTitle>
          </DialogHeader>
          {selected && <RolloverDetail data={selected} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RolloverDetail({ data }) {
  const s = data.summary;
  return (
    <div className="space-y-5 py-2">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <MiniStat label="Yatırım" value={s.deposit} tone="green" icon={TrendingUp} />
        <MiniStat label="Çekim" value={s.withdrawal} tone="red" icon={TrendingDown} />
        <MiniStat label="Komisyon" value={s.commission} tone="yellow" icon={Percent} />
        <MiniStat label="Gider" value={s.expense} tone="red" icon={Receipt} />
        <MiniStat label="Kar / Zarar" value={s.profit_loss} tone={s.profit_loss >= 0 ? "green" : "red"} icon={Landmark} />
        <MiniStat label="Devreden Nakit" value={data.total_cash_at_close} tone={data.total_cash_at_close >= 0 ? "green" : "red"} icon={Wallet} />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2 flex items-center gap-2"><Wallet className="w-3.5 h-3.5" /> Kasa Bakiyeleri</div>
        <div className="border border-border rounded-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Kasa</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Açılış</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Değişim</TableHead>
                <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Kapanış (Devreden)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.kasa_snapshots.map((k) => (
                <TableRow key={k.id} className="border-border">
                  <TableCell className="text-sm text-foreground">{k.name}</TableCell>
                  <TableCell className="text-right font-data text-sm text-muted-foreground">{fmtTRY(k.opening_balance)}</TableCell>
                  <TableCell className={`text-right font-data text-sm ${k.delta >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`}>{k.delta >= 0 ? "+" : ""}{fmtTRY(k.delta)}</TableCell>
                  <TableCell className={`text-right font-data text-sm font-medium ${k.closing_balance >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`}>{fmtTRY(k.closing_balance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {data.debtor_snapshots.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2 flex items-center gap-2"><Coins className="w-3.5 h-3.5" /> Manuel Sağlayıcı Bakiyeleri</div>
          <div className="border border-border rounded-sm overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Manuel Sağlayıcı</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-right">Ay Sonu Bakiye</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.debtor_snapshots.map((d) => (
                  <TableRow key={d.id} className="border-border">
                    <TableCell className="text-sm text-foreground">{d.name}</TableCell>
                    <TableCell className={`text-right font-data text-sm ${d.balance >= 0 ? "text-foreground" : "text-[hsl(144_100%_55%)]"}`}>{fmtTRY(d.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {data.note && (
        <div className="text-xs text-muted-foreground border-l-2 border-primary pl-3">
          <div className="text-[10px] uppercase tracking-[0.25em] mb-1">Not</div>
          {data.note}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, tone, icon: Icon }) {
  const toneMap = {
    green: "text-[hsl(144_100%_55%)]",
    red: "text-[hsl(345_100%_65%)]",
    yellow: "text-[hsl(53_98%_60%)]",
  };
  return (
    <div className="border border-border rounded-sm bg-secondary/20 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
        {Icon && <Icon className="w-3 h-3 text-muted-foreground" />}
      </div>
      <div className={`font-data text-lg font-light ${toneMap[tone] || "text-foreground"}`}>{fmtTRY(value)}</div>
    </div>
  );
}

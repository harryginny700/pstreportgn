import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtTRY } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Wallet, Send, Loader2 } from "lucide-react";

export default function CashRegisters() {
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/dashboard");
      setBalances(r.data.balances || []);
    } catch (e) {
      toast.error("Yüklenemedi");
    } finally {
      setLoading(false);
    }
  };

  const sendTelegram = async () => {
    setSending(true);
    try {
      await api.post("/kasalar/send-telegram");
      toast.success("Kasalar Telegram grubuna gönderildi");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Gönderilemedi");
    } finally {
      setSending(false);
    }
  };

  useEffect(() => { load(); }, []);

  const total = balances.reduce((a, b) => a + b.balance, 0);

  return (
    <div className="space-y-6" data-testid="kasalar-page">
      <div className="border border-border rounded-sm bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Wallet className="w-4 h-4 text-primary" />
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Toplam Kasa Bakiyesi</div>
            </div>
            <div className={`font-data text-4xl font-light tracking-tight ${total >= 0 ? "text-[hsl(144_100%_55%)] glow-green" : "text-[hsl(345_100%_65%)] glow-red"}`} data-testid="kasalar-total">
              {fmtTRY(total)}
            </div>
          </div>
          <Button
            onClick={sendTelegram}
            disabled={sending || loading || balances.length === 0}
            className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95 disabled:opacity-60"
            data-testid="kasalar-send-telegram"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Kasaları Gönder
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-sm bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-medium">Kasa</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-medium text-right">Açılış Bakiyesi</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-medium text-right">Net Değişim</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-medium text-right">Anlık Bakiye</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {balances.map((b) => {
              const delta = b.balance - b.initial_balance;
              return (
                <TableRow key={b.id} className="border-border hover:bg-white/[0.02]" data-testid={`kasa-row-${b.name}`}>
                  <TableCell className="font-medium text-white text-sm">{b.name}</TableCell>
                  <TableCell className="text-right font-data text-sm text-neutral-400">{fmtTRY(b.initial_balance)}</TableCell>
                  <TableCell className={`text-right font-data text-sm ${delta >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`}>
                    {delta >= 0 ? "+" : ""}{fmtTRY(delta)}
                  </TableCell>
                  <TableCell className={`text-right font-data text-base font-medium ${b.balance >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`} data-testid={`kasa-balance-${b.name}`}>
                    {fmtTRY(b.balance)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {loading && <div className="text-xs text-neutral-500 font-data">Yükleniyor...</div>}
    </div>
  );
}

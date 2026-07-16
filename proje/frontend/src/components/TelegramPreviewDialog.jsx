import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Send, Loader2, AlertTriangle, MessageSquare } from "lucide-react";
import { api } from "@/lib/api";

/**
 * Preview + confirm modal for Telegram messages.
 *
 * Props:
 *   open            boolean
 *   onOpenChange    fn(bool)
 *   title           string — modal title
 *   previewUrl      string — GET endpoint returning {message, configured}
 *   sendUrl         string — POST endpoint to actually send
 *   onSent          fn() — optional callback after successful send
 */
export default function TelegramPreviewDialog({ open, onOpenChange, title, previewUrl, sendUrl, onSent }) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [configured, setConfigured] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) {
      setMessage("");
      setErr("");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await api.get(previewUrl);
        if (cancelled) return;
        setMessage(r.data.message || "");
        setConfigured(!!r.data.configured);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.detail || "Önizleme yüklenemedi");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, previewUrl]);

  const send = async () => {
    setSending(true);
    try {
      await api.post(sendUrl);
      toast.success("Telegram grubuna gönderildi");
      onOpenChange(false);
      if (onSent) onSent();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Gönderilemedi");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border rounded-sm max-w-2xl max-h-[85vh] flex flex-col" data-testid="telegram-preview-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" /> {title}
          </DialogTitle>
        </DialogHeader>

        {!configured && !loading && (
          <div className="border border-[hsl(45_100%_55%)] bg-[hsl(45_100%_55%_/_0.08)] rounded-sm p-3 flex items-start gap-2 text-xs text-foreground" data-testid="tg-not-configured-warning">
            <AlertTriangle className="w-4 h-4 text-[hsl(45_100%_55%)] shrink-0 mt-0.5" />
            <div>Telegram bot token'ı ve grup ID'si tanımlı değil. Gönderim başarısız olacak — <b>Ayarlar → Telegram</b> bölümünden yapılandırın.</div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto border border-border rounded-sm bg-background p-4 min-h-[240px]" data-testid="telegram-preview-body">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-data">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Önizleme yükleniyor...
            </div>
          )}
          {err && !loading && (
            <div className="text-xs text-[hsl(345_100%_65%)] font-data">{err}</div>
          )}
          {!loading && !err && (
            <pre className="whitespace-pre-wrap font-data text-[13px] leading-relaxed text-foreground" data-testid="telegram-preview-text">
              {message}
            </pre>
          )}
        </div>

        <DialogFooter className="flex flex-row justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={sending}
            className="rounded-sm border border-border h-9"
            data-testid="telegram-preview-cancel"
          >
            İptal
          </Button>
          <Button
            onClick={send}
            disabled={sending || loading || !!err || !configured}
            className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95 disabled:opacity-60"
            data-testid="telegram-preview-send"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Telegram'a Gönder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

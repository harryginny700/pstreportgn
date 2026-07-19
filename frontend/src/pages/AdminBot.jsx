import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Bot, Save, Send, PlugZap, Loader2, RefreshCw, Bell, CircleCheck, CircleX, MinusCircle } from "lucide-react";

const EVENT_LABELS = {
  partner_movement: {
    label: "Ortak Kasa Hareketleri",
    desc: "Kasa çekimleri, dağıtımlar ve hareketlerde bildirim.",
  },
  site_credit_created: {
    label: "Yeni Kredi Açıldı",
    desc: "Bir siteye yeni kredi açıldığında bildirim.",
  },
  site_credit_paid: {
    label: "Kredi Ödemesi Alındı",
    desc: "Bir site kredi ödemesi (partial/full) kaydettiğinde bildirim.",
  },
  site_setup: {
    label: "Yeni Site Kurulumu",
    desc: "Yeni Kurulum wizard'ından bir site açıldığında bildirim.",
  },
  admin_payment_created: {
    label: "Yeni Admin Ödemesi",
    desc: "Ödemeler sayfasında yeni bir gider kaydedildiğinde bildirim.",
  },
  daily_digest: {
    label: "Günlük Özet (10:00 TR)",
    desc: "Her gün sabah 10:00 (TR) toplam gelir/gider/net özeti.",
  },
};

const STATUS_STYLES = {
  sent: { icon: CircleCheck, cls: "text-[hsl(144_100%_55%)]", label: "Gönderildi" },
  skipped_disabled: { icon: MinusCircle, cls: "text-muted-foreground", label: "Atlandı (kapalı)" },
};

function statusStyle(status) {
  if (status === "sent") return STATUS_STYLES.sent;
  if (status === "skipped_disabled") return STATUS_STYLES.skipped_disabled;
  return { icon: CircleX, cls: "text-[hsl(345_100%_65%)]", label: status };
}

export default function AdminBot() {
  const [cfg, setCfg] = useState({
    telegram_bot_token: "",
    telegram_chat_id: "",
    configured: false,
    notification_prefs: Object.keys(EVENT_LABELS).reduce((a, k) => ({ ...a, [k]: true }), {}),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [logs, setLogs] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, l] = await Promise.all([
        api.get("/admin/notifications/config"),
        api.get("/admin/notifications/logs", { params: { limit: 30 } }),
      ]);
      setCfg(c.data);
      setLogs(l.data?.items || []);
    } catch (e) {
      toast.error("Yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const r = await api.put("/admin/notifications/config", {
        telegram_bot_token: cfg.telegram_bot_token || "",
        telegram_chat_id: cfg.telegram_chat_id || "",
        notification_prefs: cfg.notification_prefs,
      });
      setCfg(r.data);
      toast.success("Bot yapılandırması kaydedildi");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const r = await api.post("/admin/notifications/test");
      if (r.data?.ok) {
        toast.success("Bağlantı başarılı, test mesajı Telegram'a gönderildi ✓");
      } else {
        toast.error(`Bağlantı başarısız: ${r.data?.error || "bilinmeyen"}`);
      }
      // refresh logs to show the test attempt
      const l = await api.get("/admin/notifications/logs", { params: { limit: 30 } });
      setLogs(l.data?.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Test başarısız");
    } finally {
      setTesting(false);
    }
  };

  const refreshLogs = async () => {
    setRefreshing(true);
    try {
      const l = await api.get("/admin/notifications/logs", { params: { limit: 30 } });
      setLogs(l.data?.items || []);
    } finally {
      setRefreshing(false);
    }
  };

  const togglePref = (key) => {
    setCfg((c) => ({
      ...c,
      notification_prefs: { ...(c.notification_prefs || {}), [key]: !c.notification_prefs?.[key] },
    }));
  };

  return (
    <div className="space-y-6" data-testid="admin-bot-page">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Bot className="w-5 h-5 text-primary" />
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Admin</div>
          <h2 className="font-display text-xl text-foreground">Telegram Botu</h2>
        </div>
        <div className="text-xs">
          {cfg.configured ? (
            <span className="inline-flex items-center gap-1 text-[hsl(144_100%_55%)]" data-testid="ab-status-configured">
              <PlugZap className="w-3.5 h-3.5" /> Aktif
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[hsl(45_100%_55%)]" data-testid="ab-status-not-configured">
              <PlugZap className="w-3.5 h-3.5" /> Yapılandırılmadı
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-6">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Yükleniyor...
        </div>
      ) : (
        <>
          {/* Bot config */}
          <div className="border border-border rounded-sm bg-card p-5">
            <div className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" /> Bot Yapılandırması
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">
                  Bot Token
                </label>
                <Input
                  value={cfg.telegram_bot_token || ""}
                  onChange={(e) => setCfg({ ...cfg, telegram_bot_token: e.target.value })}
                  placeholder="123456789:ABC-DEF..."
                  className="bg-transparent border-border rounded-sm h-9 font-data text-xs"
                  data-testid="ab-token"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  @BotFather üzerinden alacağınız API token.
                </p>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">
                  Chat / Grup ID
                </label>
                <Input
                  value={cfg.telegram_chat_id || ""}
                  onChange={(e) => setCfg({ ...cfg, telegram_chat_id: e.target.value })}
                  placeholder="-1001234567890"
                  className="bg-transparent border-border rounded-sm h-9 font-data text-xs"
                  data-testid="ab-chat"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Botu grubunuza ekleyip @get_id_bot ile grup ID'sini alın.
                </p>
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  onClick={saveConfig}
                  disabled={saving}
                  className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95 disabled:opacity-60"
                  data-testid="ab-save"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Kaydet
                </Button>
                <Button
                  onClick={testConnection}
                  disabled={testing || !cfg.configured}
                  variant="outline"
                  className="rounded-sm border-border h-9 gap-2 disabled:opacity-40"
                  data-testid="ab-test"
                  title={cfg.configured ? "Test mesajı gönder" : "Önce token+chat_id kaydedin"}
                >
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Test Mesajı Gönder
                </Button>
              </div>
            </div>
          </div>

          {/* Notification prefs */}
          <div className="border border-border rounded-sm bg-card p-5">
            <div className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" /> Otomatik Bildirim Ayarları
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Her olay türü için Telegram bildirimini açık/kapalı yapabilirsiniz. Değişiklikler "Kaydet" ile uygulanır.
            </p>
            <div className="space-y-2">
              {Object.entries(EVENT_LABELS).map(([key, meta]) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 py-3 px-3 border border-border rounded-sm hover:bg-white/[0.02] transition-colors"
                  data-testid={`ab-pref-${key}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-foreground">{meta.label}</div>
                    <div className="text-[11px] text-muted-foreground">{meta.desc}</div>
                  </div>
                  <Switch
                    checked={!!cfg.notification_prefs?.[key]}
                    onCheckedChange={() => togglePref(key)}
                    data-testid={`ab-toggle-${key}`}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-4">
              <Button
                onClick={saveConfig}
                disabled={saving}
                className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95 disabled:opacity-60"
                data-testid="ab-prefs-save"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Tercihleri Kaydet
              </Button>
            </div>
          </div>

          {/* Recent logs */}
          <div className="border border-border rounded-sm bg-card">
            <div className="p-5 border-b border-border flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground flex items-center gap-2">
                <Bell className="w-4 h-4 text-primary" /> Son Bildirimler
              </div>
              <Button
                onClick={refreshLogs}
                disabled={refreshing}
                variant="ghost"
                size="sm"
                className="rounded-sm text-xs h-7 gap-1"
                data-testid="ab-logs-refresh"
              >
                {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Yenile
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Zaman</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Olay</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Durum</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Önizleme</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 && (
                  <TableRow className="border-border">
                    <TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-6">
                      Henüz bildirim gönderilmemiş.
                    </TableCell>
                  </TableRow>
                )}
                {logs.map((row) => {
                  const meta = EVENT_LABELS[row.event_type] || { label: row.event_type };
                  const st = statusStyle(row.status);
                  const SIcon = st.icon;
                  return (
                    <TableRow key={row.id} className="border-border" data-testid={`ab-log-${row.id}`}>
                      <TableCell className="font-data text-[11px] text-muted-foreground whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString("tr-TR")}
                      </TableCell>
                      <TableCell className="text-xs text-foreground">{meta.label}</TableCell>
                      <TableCell className="text-xs">
                        <span className={`inline-flex items-center gap-1 ${st.cls}`}>
                          <SIcon className="w-3 h-3" /> {st.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground max-w-[400px] truncate">
                        {row.text_preview}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

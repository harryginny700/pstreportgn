import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { DollarSign, Save, Loader2, RefreshCw, Zap, Hand, TrendingUp } from "lucide-react";

const SOURCE_LABELS = {
  frankfurter: "Frankfurter (ECB)",
  "open.er-api": "OpenExchangeRate",
  manual: "Manuel Giriş",
};

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("tr-TR");
  } catch {
    return iso;
  }
}

export default function AdminSettingsUsdRate() {
  const [data, setData] = useState({
    usd_rate: 0,
    updated_at: null,
    mode: "auto",
    source: null,
    last_fetch_at: null,
    fetch_error: null,
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/settings/usd-rate");
      setData(r.data);
      setInput(String(r.data.usd_rate || ""));
    } catch (e) {
      toast.error("Kur bilgisi yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveManualRate = async () => {
    const val = parseFloat(input);
    if (isNaN(val) || val <= 0) return toast.error("Geçerli bir kur girin");
    setSaving(true);
    try {
      const r = await api.put("/admin/settings/usd-rate", { usd_rate: val, mode: "manual" });
      setData(r.data);
      setInput(String(r.data.usd_rate || ""));
      toast.success(`Manuel kur uygulandı: 1 USD = ${val} TRY`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kur kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  const refreshLive = async () => {
    setRefreshing(true);
    try {
      const r = await api.post("/admin/settings/usd-rate/refresh");
      setData(r.data);
      setInput(String(r.data.usd_rate || ""));
      toast.success(`Canlı kur çekildi: 1 USD = ${r.data.usd_rate?.toFixed(4)} TRY`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Canlı kur alınamadı");
    } finally {
      setRefreshing(false);
    }
  };

  const toggleAuto = async (checked) => {
    setSwitching(true);
    const newMode = checked ? "auto" : "manual";
    try {
      const r = await api.put("/admin/settings/usd-rate", { mode: newMode });
      setData(r.data);
      setInput(String(r.data.usd_rate || ""));
      toast.success(checked ? "Otomatik moda geçildi — canlı kur çekildi" : "Manuel moda geçildi");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Mod değiştirilemedi");
    } finally {
      setSwitching(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-6">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Yükleniyor...
      </div>
    );
  }

  const isAuto = data.mode === "auto";

  return (
    <div className="space-y-4" data-testid="admin-settings-usd">
      {/* Current rate hero */}
      <div className="border border-border rounded-sm bg-card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-1">Anlık USD / TRY Kuru</div>
            <div className="flex items-baseline gap-2">
              <DollarSign className="w-5 h-5 text-[hsl(144_100%_55%)]" />
              <span className="font-display text-3xl text-foreground font-semibold" data-testid="us-current-rate">
                {data.usd_rate ? data.usd_rate.toFixed(4) : "—"}
              </span>
              <span className="text-sm text-muted-foreground">TRY</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-2 space-y-0.5">
              <div>
                <span className="uppercase tracking-widest text-[9px] mr-1">Kaynak:</span>
                <span className="font-data" data-testid="us-source">{SOURCE_LABELS[data.source] || data.source || "—"}</span>
              </div>
              <div>
                <span className="uppercase tracking-widest text-[9px] mr-1">Son güncelleme:</span>
                <span className="font-data" data-testid="us-updated">{fmtDate(data.updated_at)}</span>
              </div>
              {data.last_fetch_at && data.last_fetch_at !== data.updated_at && (
                <div>
                  <span className="uppercase tracking-widest text-[9px] mr-1">Son deneme:</span>
                  <span className="font-data">{fmtDate(data.last_fetch_at)}</span>
                </div>
              )}
              {data.fetch_error && (
                <div className="text-[hsl(345_100%_65%)]" data-testid="us-fetch-error">Hata: {data.fetch_error}</div>
              )}
            </div>
          </div>
          <Button
            onClick={refreshLive}
            disabled={refreshing}
            variant="outline"
            className="rounded-sm border-border h-9 gap-2 shrink-0"
            data-testid="us-refresh"
          >
            {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Canlı Kuru Çek
          </Button>
        </div>
      </div>

      {/* Auto/manual toggle */}
      <div className="border border-border rounded-sm bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground flex items-center gap-2">
              {isAuto ? <Zap className="w-4 h-4 text-[hsl(45_100%_60%)]" /> : <Hand className="w-4 h-4 text-primary" />}
              Otomatik Kur Güncelleme
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {isAuto
                ? "Sistem her saat başı canlı kuru otomatik olarak çeker (Frankfurter → OpenExchangeRate)."
                : "Otomatik güncelleme kapalı. Aşağıdaki alandan manuel kur girebilirsiniz."}
            </p>
          </div>
          <Switch
            checked={isAuto}
            onCheckedChange={toggleAuto}
            disabled={switching}
            data-testid="us-auto-toggle"
          />
        </div>
      </div>

      {/* Manual override */}
      <div className="border border-border rounded-sm bg-card p-5">
        <div className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" /> Manuel Kur Girişi
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Aşağıdaki alana kur yazıp kaydettiğinizde sistem otomatik olarak <span className="text-foreground">Manuel</span> moda geçer.
          Otomatik moda dönmek için yukarıdaki anahtarı açın — anında canlı kur çekilir.
        </p>
        <div className="flex items-end gap-2">
          <div className="flex-1 max-w-[200px]">
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">
              1 USD = ? TRY
            </label>
            <Input
              type="number"
              step="0.0001"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="bg-transparent border-border rounded-sm h-9 font-data text-sm"
              data-testid="us-manual-input"
              placeholder="45.0000"
            />
          </div>
          <Button
            onClick={saveManualRate}
            disabled={saving}
            className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95"
            data-testid="us-manual-save"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Manuel Kaydet
          </Button>
        </div>
      </div>
    </div>
  );
}

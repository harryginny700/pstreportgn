import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff, Smartphone, Loader2, Copy, Check } from "lucide-react";

/**
 * TOTP 2FA management widget for the Profile page.
 * - Renders enabled/disabled state.
 * - "Kur" opens setup wizard: QR + secret + code verify.
 * - "Devre dışı bırak" asks current password (blocked for admins by backend).
 */
export default function TwoFactorSection() {
  const { user, refresh } = useAuth();
  const [enabled, setEnabled] = useState(!!user?.totp_enabled);
  const [enabledAt, setEnabledAt] = useState(user?.totp_enabled_at || null);
  const isAdmin = user?.platform_role === "admin";

  // Setup wizard state
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupData, setSetupData] = useState(null); // {secret, qr_data_url, provisioning_uri}
  const [setupCode, setSetupCode] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Disable state
  const [disablePw, setDisablePw] = useState("");
  const [disableBusy, setDisableBusy] = useState(false);

  useEffect(() => {
    setEnabled(!!user?.totp_enabled);
    setEnabledAt(user?.totp_enabled_at || null);
  }, [user?.totp_enabled, user?.totp_enabled_at]);

  const startSetup = async () => {
    setSetupBusy(true);
    try {
      const r = await api.post("/auth/2fa/setup");
      setSetupData(r.data);
      setSetupOpen(true);
      setSetupCode("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kurulum başlatılamadı");
    } finally {
      setSetupBusy(false);
    }
  };

  const verifySetup = async () => {
    const code = setupCode.trim().replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) return toast.error("6 haneli kodu girin");
    setSetupBusy(true);
    try {
      await api.post("/auth/2fa/verify-setup", { code });
      toast.success("2FA aktif edildi");
      setSetupOpen(false);
      setSetupData(null);
      setSetupCode("");
      setEnabled(true);
      setEnabledAt(new Date().toISOString());
      if (refresh) await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Doğrulama başarısız");
    } finally {
      setSetupBusy(false);
    }
  };

  const disable2FA = async () => {
    if (!disablePw) return toast.error("Mevcut şifreyi girin");
    setDisableBusy(true);
    try {
      await api.post("/auth/2fa/disable", { current_password: disablePw });
      toast.success("2FA devre dışı bırakıldı");
      setDisablePw("");
      setEnabled(false);
      setEnabledAt(null);
      if (refresh) await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Devre dışı bırakılamadı");
    } finally {
      setDisableBusy(false);
    }
  };

  const copySecret = () => {
    if (!setupData?.secret) return;
    navigator.clipboard.writeText(setupData.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border border-border rounded-sm bg-card p-6" data-testid="profile-2fa-section">
      <div className="flex items-center gap-2 mb-4">
        {enabled ? <ShieldCheck className="w-4 h-4 text-[hsl(144_100%_55%)]" /> : <ShieldOff className="w-4 h-4 text-muted-foreground" />}
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">İki Adımlı Doğrulama (2FA)</div>
          <div className="font-display text-lg text-foreground">
            {enabled ? "Etkin" : "Kapalı"}
            {isAdmin && !enabled && <span className="ml-2 text-[10px] uppercase tracking-[0.2em] text-[hsl(45_100%_55%)]">Admin için zorunlu</span>}
          </div>
          {enabled && enabledAt && (
            <div className="text-[10px] font-data text-muted-foreground mt-0.5">Aktif tarih: {new Date(enabledAt).toLocaleString("tr-TR")}</div>
          )}
        </div>
      </div>

      {!enabled && !setupOpen && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed max-w-lg">
            Google Authenticator, Authy veya Microsoft Authenticator uygulamasıyla, girişte 6 haneli kod istenecek. Bu kod sadece telefonunuzda üretilir.
          </p>
          <Button onClick={startSetup} disabled={setupBusy} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95" data-testid="totp-setup-btn">
            {setupBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
            2FA Kurulumunu Başlat
          </Button>
        </div>
      )}

      {!enabled && setupOpen && setupData && (
        <div className="space-y-4 border-t border-border pt-4" data-testid="totp-setup-wizard">
          <div className="grid md:grid-cols-[auto,1fr] gap-4">
            <div className="border border-border rounded-sm p-2 bg-white w-fit">
              <img src={setupData.qr_data_url} alt="TOTP QR" className="w-40 h-40" data-testid="totp-qr" />
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-1">1 · QR'ı tarayın</div>
                <p className="text-xs text-muted-foreground">Authenticator uygulamanızı açıp QR'ı tarayın.</p>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-1">Veya bu kodu elle girin</div>
                <div className="flex items-center gap-2">
                  <code className="bg-background border border-border rounded-sm px-2 py-1 font-data text-xs text-foreground break-all" data-testid="totp-secret">{setupData.secret}</code>
                  <button onClick={copySecret} className="p-1.5 rounded-sm border border-border hover:bg-secondary" title="Kopyala" data-testid="totp-copy-secret">
                    {copied ? <Check className="w-3.5 h-3.5 text-[hsl(144_100%_55%)]" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-1">2 · Uygulamadaki 6 haneli kodu girin</div>
                <Input
                  value={setupCode}
                  onChange={(e) => setSetupCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                  className="bg-transparent border-border rounded-sm h-10 font-data tracking-[0.4em] text-center max-w-[220px] text-lg"
                  placeholder="000000"
                  maxLength={6}
                  inputMode="numeric"
                  data-testid="totp-setup-code"
                />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={verifySetup} disabled={setupBusy || setupCode.length !== 6} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95 disabled:opacity-60" data-testid="totp-verify-btn">
              {setupBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Doğrula ve Etkinleştir
            </Button>
            <Button variant="ghost" onClick={() => { setSetupOpen(false); setSetupData(null); setSetupCode(""); }} className="rounded-sm border border-border h-9" data-testid="totp-cancel-setup">
              İptal
            </Button>
          </div>
        </div>
      )}

      {enabled && (
        <div className="space-y-3 border-t border-border pt-4">
          {isAdmin ? (
            <p className="text-xs text-muted-foreground leading-relaxed max-w-lg">
              Admin hesabınızda 2FA zorunlu olduğu için kendiniz devre dışı bırakamazsınız. Sıfırlamak için başka bir adminden <b>Admin Paneli → Kullanıcılar → 2FA Sıfırla</b> talep edin.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Devre dışı bırakmak için mevcut şifrenizi girin.</p>
              <div className="flex gap-2 items-end max-w-md">
                <div className="flex-1">
                  <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Mevcut Şifre</label>
                  <Input type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} className="bg-transparent border-border rounded-sm h-9" data-testid="totp-disable-pw" />
                </div>
                <Button onClick={disable2FA} disabled={disableBusy || !disablePw} className="rounded-sm bg-[hsl(345_100%_55%)] text-white hover:bg-[hsl(345_100%_50%)] h-9 gap-2 disabled:opacity-60" data-testid="totp-disable-btn">
                  {disableBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldOff className="w-4 h-4" />}
                  Devre Dışı Bırak
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

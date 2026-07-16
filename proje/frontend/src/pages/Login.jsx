import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Activity, Loader2, Sun, Moon } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // 2FA challenge state
  const [twofaChallenge, setTwofaChallenge] = useState(null); // {challenge_token, email}
  const [twofaCode, setTwofaCode] = useState("");
  const { login, completeLogin2FA } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const { lang, t, toggle: toggleLang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();

  const finishLogin = (u) => {
    toast.success(`${t("login.welcome")}${u.name ? `, ${u.name}` : ""}`);
    const redirect = location.state?.from || (u.platform_role === "admin" ? "/admin" : "/");
    navigate(redirect, { replace: true });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!email || !password) return toast.error(t("login.errRequired"));
    setLoading(true);
    try {
      const res = await login(email.trim(), password);
      if (res && res.requires_2fa) {
        setTwofaChallenge({ challenge_token: res.challenge_token, email: res.email });
        setTwofaCode("");
        return;
      }
      finishLogin(res);
    } catch (err) {
      toast.error(err?.response?.data?.detail || t("login.errFailed"));
    } finally {
      setLoading(false);
    }
  };

  const submit2FA = async (e) => {
    e.preventDefault();
    const code = twofaCode.trim().replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) return toast.error("6 haneli kodu girin");
    setLoading(true);
    try {
      const u = await completeLogin2FA(twofaChallenge.challenge_token, code);
      finishLogin(u);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Kod hatalı");
    } finally {
      setLoading(false);
    }
  };

  const cancel2FA = () => {
    setTwofaChallenge(null);
    setTwofaCode("");
    setPassword("");
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex relative" data-testid="login-page">
      {/* Top-right controls */}
      <div className="absolute top-6 right-6 z-10 flex items-center gap-2">
        <button
          onClick={toggleLang}
          aria-label={t("lang.toggle", "Dil değiştir")}
          data-testid="lang-toggle"
          title={lang === "tr" ? "Switch to English" : "Türkçe'ye geç"}
          className="h-9 px-3 rounded-sm border border-border hover:bg-secondary flex items-center justify-center transition-colors active:scale-95 font-data text-[11px] uppercase tracking-[0.15em] text-foreground"
        >
          {lang === "tr" ? "TR" : "EN"}
        </button>
        <button
          onClick={toggleTheme}
          aria-label={t("theme.toggle", "Tema değiştir")}
          data-testid="theme-toggle-login"
          className="w-9 h-9 rounded-sm border border-border hover:bg-secondary flex items-center justify-center transition-colors active:scale-95"
        >
          {theme === "dark" ? <Sun className="w-4 h-4 text-primary" /> : <Moon className="w-4 h-4 text-primary" />}
        </button>
      </div>
      {/* Brand panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 border-r border-border p-12 bg-gradient-to-br from-background to-secondary relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{
          backgroundImage: "radial-gradient(circle at 20% 30%, hsl(53 98% 53%) 0%, transparent 50%)"
        }} />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-sm bg-primary flex items-center justify-center">
              <Activity className="w-6 h-6 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-display text-xl font-semibold text-foreground leading-tight">PLAYSPINTECH</div>
              <div className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground">iGaming · Finance Suite</div>
            </div>
          </div>
        </div>
        <div className="relative">
          <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">{t("login.today")}</div>
          <h1 className="font-display text-4xl lg:text-5xl font-light text-foreground leading-[1.05] tracking-tight mb-6">
            {t("login.brandLine1")}<br/>
            <span className="text-primary">{t("login.brandLine2")}</span><br/>
            {t("login.brandLine3")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
            {t("login.brandDesc")}
          </p>
        </div>
        <div className="relative text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-data">
          © 2026 · Playspintech
        </div>
      </div>

      {/* Login form */}
      <div className="flex-1 flex items-center justify-center p-8">
        {twofaChallenge ? (
          <form onSubmit={submit2FA} className="w-full max-w-sm" data-testid="login-2fa-form">
            <div className="lg:hidden mb-8 flex items-center gap-2">
              <div className="w-9 h-9 rounded-sm bg-primary flex items-center justify-center">
                <Activity className="w-5 h-5 text-primary-foreground" strokeWidth={2.5} />
              </div>
              <div className="font-display text-lg text-foreground">PLAYSPINTECH</div>
            </div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">İki Adımlı Doğrulama</div>
            <h2 className="font-display text-2xl text-foreground mb-2">6 haneli kodu girin</h2>
            <p className="text-xs text-muted-foreground mb-6">
              <span className="font-data">{twofaChallenge.email}</span> için Authenticator uygulamanızdaki mevcut kodu girin.
            </p>
            <Input
              value={twofaCode}
              onChange={(e) => setTwofaCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
              className="bg-transparent border-border rounded-sm h-14 text-center font-data text-2xl tracking-[0.5em]"
              placeholder="000000"
              autoFocus
              inputMode="numeric"
              maxLength={6}
              data-testid="login-2fa-code"
            />
            <Button
              type="submit"
              disabled={loading || twofaCode.length !== 6}
              className="w-full mt-4 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-11 font-medium tracking-tight active:scale-[0.98] disabled:opacity-60"
              data-testid="login-2fa-submit"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Doğrula ve Giriş Yap"}
            </Button>
            <button
              type="button"
              onClick={cancel2FA}
              className="w-full mt-4 text-[11px] uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground transition-colors"
              data-testid="login-2fa-cancel"
            >
              ← Farklı hesapla giriş yap
            </button>
          </form>
        ) : (
          <form onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
          <div className="lg:hidden mb-8 flex items-center gap-2">
            <div className="w-9 h-9 rounded-sm bg-primary flex items-center justify-center">
              <Activity className="w-5 h-5 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <div className="font-display text-lg text-foreground">PLAYSPINTECH</div>
          </div>

          <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">{t("login.subtitle")}</div>
          <h2 className="font-display text-2xl text-foreground mb-8">{t("login.title")}</h2>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">{t("login.email")}</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-transparent border-border rounded-sm h-11 text-sm"
                autoFocus
                data-testid="login-email"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">{t("login.password")}</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-transparent border-border rounded-sm h-11 text-sm"
                data-testid="login-password"
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full mt-6 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-11 font-medium tracking-tight active:scale-[0.98] disabled:opacity-60"
            data-testid="login-submit"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("login.submit")}
          </Button>

          <div className="mt-8 text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-center">
            {t("login.hint")}
          </div>
        </form>
        )}
      </div>
    </div>
  );
}

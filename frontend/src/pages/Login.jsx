import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Activity, Loader2 } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const submit = async (e) => {
    e.preventDefault();
    if (!email || !password) return toast.error("E-posta ve şifre gerekli");
    setLoading(true);
    try {
      const u = await login(email.trim(), password);
      toast.success(`Hoş geldin${u.name ? `, ${u.name}` : ""}`);
      const redirect = location.state?.from || (u.platform_role === "admin" ? "/admin" : "/");
      navigate(redirect, { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Giriş başarısız");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex" data-testid="login-page">
      {/* Brand panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 border-r border-border p-12 bg-gradient-to-br from-background to-black relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{
          backgroundImage: "radial-gradient(circle at 20% 30%, hsl(53 98% 53%) 0%, transparent 50%)"
        }} />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-sm bg-primary flex items-center justify-center">
              <Activity className="w-6 h-6 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-display text-xl font-semibold text-white leading-tight">PLAYSPINTECH</div>
              <div className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground">iGaming · Finance Suite</div>
            </div>
          </div>
        </div>
        <div className="relative">
          <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">Bugünkü modül</div>
          <h1 className="font-display text-4xl lg:text-5xl font-light text-white leading-[1.05] tracking-tight mb-6">
            Sitelerin<br/>
            <span className="text-primary">finansal kontrolü</span><br/>
            tek panelde.
          </h1>
          <p className="text-sm text-neutral-400 max-w-md leading-relaxed">
            Yatırım, çekim, komisyon, kredi, kasa transferleri ve giderler — tüm siteler için canlı takip, günlük ve aylık raporlar, CSV çıktı.
          </p>
        </div>
        <div className="relative text-[10px] uppercase tracking-[0.3em] text-neutral-600 font-data">
          © 2026 · Playspintech
        </div>
      </div>

      {/* Login form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
          <div className="lg:hidden mb-8 flex items-center gap-2">
            <div className="w-9 h-9 rounded-sm bg-primary flex items-center justify-center">
              <Activity className="w-5 h-5 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <div className="font-display text-lg text-white">PLAYSPINTECH</div>
          </div>

          <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Giriş</div>
          <h2 className="font-display text-2xl text-white mb-8">Hesabınıza girin</h2>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">E-posta</label>
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
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Şifre</label>
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
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Giriş Yap"}
          </Button>

          <div className="mt-8 text-[10px] uppercase tracking-[0.25em] text-neutral-600 text-center">
            Hesap oluşturma yetkisi sadece Playspintech admin'dedir
          </div>
        </form>
      </div>
    </div>
  );
}

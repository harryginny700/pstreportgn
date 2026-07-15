import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Lock, User as UserIcon, Shield } from "lucide-react";

export default function Profile() {
  const { user, site, isAdmin } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!current || !next) return toast.error("Tüm alanları doldurun");
    if (next.length < 6) return toast.error("Yeni şifre en az 6 karakter olmalı");
    if (next !== confirm) return toast.error("Yeni şifre ile onay uyuşmuyor");
    setSaving(true);
    try {
      await api.post("/auth/change-password", { current_password: current, new_password: next });
      toast.success("Şifreniz değiştirildi");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Hata");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl" data-testid="profile-page">
      {/* Profile info */}
      <div className="border border-border rounded-sm bg-card p-6">
        <div className="flex items-center gap-3 mb-5">
          <UserIcon className="w-4 h-4 text-primary" />
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Hesap</div>
            <h3 className="font-display text-lg text-white mt-0.5">Profil Bilgileri</h3>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-1">İsim</div>
            <div className="text-sm text-white" data-testid="profile-name">{user?.name || "-"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-1">E-posta</div>
            <div className="text-sm text-white font-data" data-testid="profile-email">{user?.email}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-1">Rol</div>
            <div className="flex items-center gap-2">
              {isAdmin ? (
                <>
                  <Shield className="w-3.5 h-3.5 text-primary" />
                  <span className="text-sm text-primary uppercase tracking-widest text-xs" data-testid="profile-role">Playspintech Admin</span>
                </>
              ) : (
                <span className="text-sm text-white uppercase tracking-widest text-xs" data-testid="profile-role">{user?.site_role || "-"}</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-1">Site</div>
            <div className="text-sm text-white" data-testid="profile-site">{site?.name || (isAdmin ? "Global" : "-")}</div>
          </div>
        </div>
      </div>

      {/* Password change */}
      <div className="border border-border rounded-sm bg-card p-6" data-testid="password-change">
        <div className="flex items-center gap-3 mb-5">
          <Lock className="w-4 h-4 text-primary" />
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Güvenlik</div>
            <h3 className="font-display text-lg text-white mt-0.5">Şifre Değiştir</h3>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Mevcut Şifre</label>
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className="bg-transparent border-border rounded-sm h-9" data-testid="pw-current" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Yeni Şifre</label>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} className="bg-transparent border-border rounded-sm h-9" data-testid="pw-new" />
            <div className="text-[10px] text-neutral-500 mt-1">En az 6 karakter</div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Tekrar</label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="bg-transparent border-border rounded-sm h-9" data-testid="pw-confirm" />
          </div>
        </div>
        <Button onClick={submit} disabled={saving} className="mt-4 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-2 active:scale-95 disabled:opacity-50" data-testid="pw-submit">
          <Lock className="w-4 h-4" /> {saving ? "Kaydediliyor..." : "Şifreyi Değiştir"}
        </Button>
      </div>
    </div>
  );
}

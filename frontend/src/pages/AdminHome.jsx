import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtTRY, monthStartISO, monthEndISO } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Users, Globe, TrendingUp, TrendingDown, Percent, Landmark, ChevronRight, ExternalLink, History, ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function AdminHome() {
  const { user, setAdminSiteId } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const [sites, setSites] = useState([]);
  const [users, setUsers] = useState([]);
  const [overview, setOverview] = useState(null);
  const [dateFrom, setDateFrom] = useState(monthStartISO());
  const [dateTo, setDateTo] = useState(monthEndISO());

  const [siteForm, setSiteForm] = useState({ name: "", slug: "" });
  const [siteDialog, setSiteDialog] = useState(false);

  const [userForm, setUserForm] = useState({ user_type: "site", email: "", password: "", name: "", site_id: "", site_role: "operator" });
  const [userDialog, setUserDialog] = useState(false);

  const loadSites = async () => {
    const r = await api.get("/admin/sites");
    setSites(r.data);
  };
  const loadUsers = async () => {
    const r = await api.get("/admin/users");
    setUsers(r.data);
  };
  const loadOverview = async () => {
    const r = await api.get("/admin/overview", { params: { date_from: dateFrom, date_to: dateTo } });
    setOverview(r.data);
  };

  useEffect(() => {
    loadSites();
    loadUsers();
    loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitSite = async () => {
    if (!siteForm.name.trim()) return toast.error("Site ismi girin");
    try {
      await api.post("/admin/sites", { name: siteForm.name.trim(), slug: siteForm.slug.trim() || null, active: true });
      toast.success("Site oluşturuldu");
      setSiteForm({ name: "", slug: "" });
      setSiteDialog(false);
      loadSites();
      loadOverview();
    } catch (e) { toast.error(e?.response?.data?.detail || "Hata"); }
  };

  const seedSite = async (sid) => {
    if (!confirm("Bu siteye varsayılan kasa/yöntem/kredici yapısı yüklensin mi?")) return;
    try {
      await api.post(`/admin/sites/${sid}/seed-defaults`);
      toast.success("Varsayılan yapı yüklendi");
      loadSites();
    } catch (e) { toast.error(e?.response?.data?.detail || "Hata"); }
  };

  const deleteSite = async (s) => {
    if (!confirm(`"${s.name}" sitesi ve TÜM verileri silinsin mi? Bu işlem geri alınamaz.`)) return;
    try {
      await api.delete(`/admin/sites/${s.id}`);
      toast.success("Site silindi");
      loadSites();
      loadUsers();
      loadOverview();
    } catch (e) { toast.error("Hata"); }
  };

  const openSite = (sid) => {
    setAdminSiteId(sid);
    navigate("/");
  };

  const submitUser = async () => {
    if (!userForm.email || !userForm.password) return toast.error("E-posta ve şifre gerekli");
    const isAdminUser = userForm.user_type === "admin";
    if (!isAdminUser && !userForm.site_id) return toast.error("Site seçin");
    try {
      const payload = {
        email: userForm.email.trim(),
        password: userForm.password,
        name: userForm.name.trim() || null,
      };
      if (isAdminUser) {
        payload.platform_role = "admin";
      } else {
        payload.site_id = userForm.site_id;
        payload.site_role = userForm.site_role;
      }
      await api.post("/admin/users", payload);
      toast.success(isAdminUser ? "Admin kullanıcı oluşturuldu" : "Site kullanıcısı oluşturuldu");
      setUserForm({ user_type: "site", email: "", password: "", name: "", site_id: "", site_role: "operator" });
      setUserDialog(false);
      loadUsers();
      loadSites();
    } catch (e) { toast.error(e?.response?.data?.detail || "Hata"); }
  };

  const deleteUser = async (u) => {
    if (u.id === user.id) return toast.error("Kendinizi silemezsiniz");
    if (!confirm(`${u.email} silinsin mi?`)) return;
    try {
      await api.delete(`/admin/users/${u.id}`);
      toast.success("Silindi");
      loadUsers();
    } catch (e) { toast.error("Hata"); }
  };

  const toggleUserActive = async (u) => {
    try {
      await api.put(`/admin/users/${u.id}`, { active: !u.active });
      loadUsers();
    } catch (e) { toast.error("Hata"); }
  };

  const siteMap = Object.fromEntries(sites.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-6" data-testid="admin-page">
      {/* Tab nav */}
      <div className="flex gap-1 border-b border-border" data-testid="admin-tabs">
        {[
          { k: "overview", label: "Genel Bakış" },
          { k: "sites", label: "Siteler" },
          { k: "users", label: "Kullanıcılar" },
          { k: "audit", label: "Denetim Kaydı" },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            data-testid={`admin-tab-${t.k}`}
            className={`px-4 py-2.5 text-xs uppercase tracking-[0.2em] border-b-2 transition-colors -mb-px ${
              tab === t.k ? "text-white border-primary" : "text-neutral-500 border-transparent hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div className="flex gap-3 items-end">
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Başlangıç</label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40 bg-transparent border-border rounded-sm font-data h-9 text-xs" data-testid="admin-date-from" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Bitiş</label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40 bg-transparent border-border rounded-sm font-data h-9 text-xs" data-testid="admin-date-to" />
              </div>
              <Button onClick={loadOverview} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 active:scale-95" data-testid="admin-apply">Uygula</Button>
            </div>
          </div>

          {overview && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard label="Toplam Site" value={overview.totals.site_count} tone="white" currency={false} icon={Globe} />
                <StatCard label="Toplam Yatırım" value={overview.totals.deposit} tone="green" icon={TrendingUp} />
                <StatCard label="Toplam Çekim" value={overview.totals.withdrawal} tone="red" icon={TrendingDown} />
                <StatCard label="Toplam Komisyon" value={overview.totals.commission} tone="yellow" icon={Percent} />
                <StatCard label="Toplam Kar/Zarar" value={overview.totals.profit_loss} tone={overview.totals.profit_loss >= 0 ? "green" : "red"} icon={Landmark} />
              </div>

              <div className="border border-border rounded-sm bg-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border">
                  <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Site Kırılımı</div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Site</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Yatırım</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Çekim</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Komisyon</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Net</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Gider</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-right">Kar/Zarar</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.sites.length === 0 && (
                      <TableRow className="border-border"><TableCell colSpan={8} className="text-center text-xs text-neutral-500 py-8">Henüz site yok</TableCell></TableRow>
                    )}
                    {overview.sites.map((s) => (
                      <TableRow key={s.site_id} className="border-border hover:bg-white/[0.02] cursor-pointer" onClick={() => openSite(s.site_id)} data-testid={`overview-site-${s.site_name}`}>
                        <TableCell className="font-medium text-white text-sm flex items-center gap-2">
                          <Globe className="w-3.5 h-3.5 text-primary" />
                          {s.site_name}
                        </TableCell>
                        <TableCell className="text-right font-data text-sm text-[hsl(144_100%_55%)]">{fmtTRY(s.deposit)}</TableCell>
                        <TableCell className="text-right font-data text-sm text-[hsl(345_100%_65%)]">{fmtTRY(s.withdrawal)}</TableCell>
                        <TableCell className="text-right font-data text-sm text-[hsl(53_98%_60%)]">{fmtTRY(s.commission)}</TableCell>
                        <TableCell className="text-right font-data text-sm text-neutral-200">{fmtTRY(s.net)}</TableCell>
                        <TableCell className="text-right font-data text-sm text-[hsl(345_100%_65%)]">{fmtTRY(s.expense)}</TableCell>
                        <TableCell className={`text-right font-data text-sm ${s.profit_loss >= 0 ? "text-[hsl(144_100%_55%)]" : "text-[hsl(345_100%_65%)]"}`}>{fmtTRY(s.profit_loss)}</TableCell>
                        <TableCell><ChevronRight className="w-3.5 h-3.5 text-neutral-500" /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "sites" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="text-xs text-neutral-400 font-data">{sites.length} site</div>
            <Dialog open={siteDialog} onOpenChange={setSiteDialog}>
              <DialogTrigger asChild>
                <Button className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 gap-2 h-9 active:scale-95" data-testid="admin-new-site-btn">
                  <Plus className="w-4 h-4" /> Yeni Site
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border rounded-sm">
                <DialogHeader><DialogTitle className="font-display text-white">Yeni Site</DialogTitle></DialogHeader>
                <div className="space-y-4 py-2">
                  <div>
                    <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Site İsmi</label>
                    <Input value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} className="bg-transparent border-border rounded-sm h-10" placeholder="Örn: Etobahis" data-testid="site-name-input" />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Kısaltma (opsiyonel)</label>
                    <Input value={siteForm.slug} onChange={(e) => setSiteForm({ ...siteForm, slug: e.target.value })} className="bg-transparent border-border rounded-sm h-10" placeholder="etobahis" data-testid="site-slug-input" />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={submitSite} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95" data-testid="site-create-submit">Oluştur</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="border border-border rounded-sm bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Site</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Slug</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 text-center">Kullanıcı</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Durum</TableHead>
                  <TableHead className="w-56"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.map((s) => (
                  <TableRow key={s.id} className="border-border hover:bg-white/[0.02]" data-testid={`site-row-${s.name}`}>
                    <TableCell className="font-medium text-white text-sm flex items-center gap-2">
                      <Globe className="w-3.5 h-3.5 text-primary" />
                      {s.name}
                    </TableCell>
                    <TableCell className="text-xs font-data text-neutral-400">{s.slug || "-"}</TableCell>
                    <TableCell className="text-center font-data text-xs text-neutral-300">{s.user_count}</TableCell>
                    <TableCell>
                      {s.active ? (
                        <Badge className="bg-[hsl(144_100%_50%)]/10 text-[hsl(144_100%_55%)] border-[hsl(144_100%_50%)]/30 rounded-sm text-[10px] uppercase tracking-widest hover:bg-[hsl(144_100%_50%)]/10">Aktif</Badge>
                      ) : (
                        <Badge variant="outline" className="rounded-sm text-[10px] uppercase tracking-widest text-neutral-500">Pasif</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1.5 justify-end">
                        <Button size="sm" variant="outline" onClick={() => openSite(s.id)} className="rounded-sm border-border h-8 gap-1 text-xs active:scale-95" data-testid={`site-open-${s.name}`}>
                          <ExternalLink className="w-3 h-3" /> Aç
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => seedSite(s.id)} className="rounded-sm border-border h-8 text-xs active:scale-95" data-testid={`site-seed-${s.name}`}>
                          Varsayılan Yükle
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteSite(s)} className="h-8 w-8 rounded-sm text-neutral-500 hover:text-red-400" data-testid={`site-delete-${s.name}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {tab === "users" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="text-xs text-neutral-400 font-data">{users.length} kullanıcı</div>
            <Dialog open={userDialog} onOpenChange={setUserDialog}>
              <DialogTrigger asChild>
                <Button className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 gap-2 h-9 active:scale-95" data-testid="admin-new-user-btn">
                  <Plus className="w-4 h-4" /> Yeni Kullanıcı
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border rounded-sm">
                <DialogHeader><DialogTitle className="font-display text-white">Yeni Kullanıcı</DialogTitle></DialogHeader>
                <div className="space-y-4 py-2">
                  <div>
                    <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Kullanıcı Tipi</label>
                    <Select value={userForm.user_type} onValueChange={(v) => setUserForm({ ...userForm, user_type: v })}>
                      <SelectTrigger className="bg-transparent border-border rounded-sm h-10" data-testid="user-type-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="site">Site Kullanıcısı</SelectItem>
                        <SelectItem value="admin">Playspintech Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    {userForm.user_type === "admin" && (
                      <div className="text-[10px] text-[hsl(45_100%_55%)] mt-1.5 font-data uppercase tracking-[0.2em]">
                        ⚠ Admin: tüm siteleri yönetir, kullanıcı ve kredi oluşturabilir.
                      </div>
                    )}
                  </div>
                  {userForm.user_type === "site" && (
                    <div>
                      <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Site</label>
                      <Select value={userForm.site_id} onValueChange={(v) => setUserForm({ ...userForm, site_id: v })}>
                        <SelectTrigger className="bg-transparent border-border rounded-sm h-10" data-testid="user-site-select"><SelectValue placeholder="Site seçin" /></SelectTrigger>
                        <SelectContent>
                          {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">E-posta</label>
                    <Input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} className="bg-transparent border-border rounded-sm h-10" data-testid="user-email-input" />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">İsim (opsiyonel)</label>
                    <Input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} className="bg-transparent border-border rounded-sm h-10" data-testid="user-name-input" />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Şifre</label>
                    <Input type="text" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} className="bg-transparent border-border rounded-sm h-10 font-data" data-testid="user-password-input" />
                    <div className="text-[10px] text-neutral-500 mt-1 font-data">
                      {userForm.user_type === "admin" ? "Admin'e güvenli bir kanalla iletiniz" : "Site kullanıcısına iletiniz"}
                    </div>
                  </div>
                  {userForm.user_type === "site" && (
                    <div>
                      <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground block mb-1.5">Rol</label>
                      <Select value={userForm.site_role} onValueChange={(v) => setUserForm({ ...userForm, site_role: v })}>
                        <SelectTrigger className="bg-transparent border-border rounded-sm h-10" data-testid="user-role-select"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="owner">Site Sahibi (Owner)</SelectItem>
                          <SelectItem value="operator">Operatör</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button onClick={submitUser} className="rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95" data-testid="user-create-submit">Oluştur</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="border border-border rounded-sm bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">E-posta</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">İsim</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Site</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Rol</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Durum</TableHead>
                  <TableHead className="w-40"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} className="border-border hover:bg-white/[0.02]" data-testid={`user-row-${u.email}`}>
                    <TableCell className="font-medium text-white text-sm">{u.email}</TableCell>
                    <TableCell className="text-sm text-neutral-300">{u.name || "-"}</TableCell>
                    <TableCell className="text-sm text-neutral-400">
                      {u.platform_role === "admin" ? (
                        <Badge className="bg-primary/20 text-primary border-primary/40 rounded-sm text-[10px] uppercase tracking-widest hover:bg-primary/20">Playspintech Admin</Badge>
                      ) : (
                        siteMap[u.site_id] || "-"
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-data text-neutral-400 uppercase tracking-wider">{u.site_role || u.platform_role || "-"}</TableCell>
                    <TableCell>
                      <button onClick={() => u.platform_role !== "admin" && toggleUserActive(u)} className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-sm border ${
                        u.active ? "text-[hsl(144_100%_55%)] border-[hsl(144_100%_50%)]/30 bg-[hsl(144_100%_50%)]/10" : "text-neutral-500 border-neutral-700"
                      }`} data-testid={`user-toggle-${u.email}`}>
                        {u.active ? "Aktif" : "Pasif"}
                      </button>
                    </TableCell>
                    <TableCell>
                      {u.platform_role !== "admin" && (
                        <Button size="icon" variant="ghost" onClick={() => deleteUser(u)} className="h-8 w-8 rounded-sm text-neutral-500 hover:text-red-400 ml-auto flex" data-testid={`user-delete-${u.email}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {tab === "audit" && <AuditLogTab />}

    </div>
  );
}

function StatCard({ label, value, tone, icon: Icon, currency = true }) {
  const toneMap = {
    green: "text-[hsl(144_100%_55%)] glow-green",
    red: "text-[hsl(345_100%_65%)] glow-red",
    yellow: "text-[hsl(53_98%_60%)] glow-yellow",
    white: "text-white",
  };
  return (
    <div className="border border-border bg-card p-5 rounded-sm">
      <div className="flex items-start justify-between mb-4">
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
        {Icon && <Icon className="w-4 h-4 text-neutral-500" />}
      </div>
      <div className={`font-data text-3xl font-light tracking-tight ${toneMap[tone] || "text-white"}`}>
        {currency ? fmtTRY(value) : value}
      </div>
    </div>
  );
}

const ACTION_LABELS = {
  "auth.login": { label: "Giriş", color: "text-neutral-400" },
  "site.create": { label: "Site Oluşturuldu", color: "text-[hsl(144_100%_55%)]" },
  "site.update": { label: "Site Güncellendi", color: "text-[hsl(53_98%_60%)]" },
  "site.delete": { label: "Site Silindi", color: "text-[hsl(345_100%_65%)]" },
  "site.seed_defaults": { label: "Varsayılan Yüklendi", color: "text-[hsl(186_100%_55%)]" },
  "user.create": { label: "Kullanıcı Oluşturuldu", color: "text-[hsl(144_100%_55%)]" },
  "user.update": { label: "Kullanıcı Güncellendi", color: "text-[hsl(53_98%_60%)]" },
  "user.delete": { label: "Kullanıcı Silindi", color: "text-[hsl(345_100%_65%)]" },
  "password_change": { label: "Şifre Değiştirildi", color: "text-[hsl(186_100%_55%)]" },
};

function AuditLogTab() {
  const [data, setData] = useState({ total: 0, items: [] });
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const PAGE_SIZE = 25;

  const load = async () => {
    setLoading(true);
    try {
      const params = { limit: PAGE_SIZE, offset };
      if (filter !== "all") params.action = filter;
      const r = await api.get("/admin/audit-logs", { params });
      setData(r.data);
    } catch (e) {
      toast.error("Yüklenemedi");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [offset, filter]);

  const fmtTs = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-4" data-testid="audit-tab">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <History className="w-4 h-4 text-primary" />
          <div className="text-xs text-neutral-400 font-data">{data.total} kayıt</div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => { setFilter(v); setOffset(0); }}>
            <SelectTrigger className="w-52 bg-transparent border-border rounded-sm h-9 text-xs" data-testid="audit-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm İşlemler</SelectItem>
              <SelectItem value="auth.login">Girişler</SelectItem>
              <SelectItem value="site.create">Site Oluşturma</SelectItem>
              <SelectItem value="site.update">Site Güncelleme</SelectItem>
              <SelectItem value="site.delete">Site Silme</SelectItem>
              <SelectItem value="site.seed_defaults">Varsayılan Yükleme</SelectItem>
              <SelectItem value="user.create">Kullanıcı Oluşturma</SelectItem>
              <SelectItem value="user.update">Kullanıcı Güncelleme</SelectItem>
              <SelectItem value="user.delete">Kullanıcı Silme</SelectItem>
              <SelectItem value="password_change">Şifre Değişiklikleri</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border border-border rounded-sm bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 w-44">Zaman</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Kullanıcı</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">İşlem</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Hedef</TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Detay</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.length === 0 && (
              <TableRow className="border-border"><TableCell colSpan={5} className="text-center text-xs text-neutral-500 font-data py-8">
                {loading ? "Yükleniyor..." : "Kayıt yok"}
              </TableCell></TableRow>
            )}
            {data.items.map((l) => {
              const meta = ACTION_LABELS[l.action] || { label: l.action, color: "text-neutral-400" };
              return (
                <TableRow key={l.id} className="border-border hover:bg-white/[0.02]" data-testid={`audit-row-${l.id}`}>
                  <TableCell className="font-data text-[11px] text-neutral-400">{fmtTs(l.timestamp)}</TableCell>
                  <TableCell className="text-sm text-white">{l.user_email}</TableCell>
                  <TableCell><span className={`text-xs uppercase tracking-wider font-medium ${meta.color}`}>{meta.label}</span></TableCell>
                  <TableCell className="text-sm text-neutral-300">
                    {l.target_name ? (
                      <span>
                        <span className="text-[10px] text-neutral-500 uppercase mr-1.5">{l.target_type}</span>
                        {l.target_name}
                      </span>
                    ) : "-"}
                  </TableCell>
                  <TableCell className="font-data text-[11px] text-neutral-500 max-w-md truncate">
                    {l.details ? Object.entries(l.details).map(([k, v]) =>
                      typeof v === "object" ? `${k}=${JSON.stringify(v)}` : `${k}=${v}`
                    ).join(" · ") : "-"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-neutral-500 font-data">Sayfa {currentPage} / {pages}</div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="rounded-sm border-border h-8 gap-1 text-xs active:scale-95 disabled:opacity-40"
              data-testid="audit-prev"
            >
              <ChevronLeft className="w-3 h-3" /> Önceki
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={offset + PAGE_SIZE >= data.total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="rounded-sm border-border h-8 gap-1 text-xs active:scale-95 disabled:opacity-40"
              data-testid="audit-next"
            >
              Sonraki <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}


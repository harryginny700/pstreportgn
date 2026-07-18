import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { api } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [site, setSite] = useState(null); // active site (for site users OR admin-selected)
  const [loading, setLoading] = useState(true);
  const [adminSiteId, setAdminSiteIdState] = useState(() => localStorage.getItem("pst_admin_site_id") || null);

  const bootstrap = useCallback(async () => {
    const token = localStorage.getItem("pst_token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const r = await api.get("/auth/me");
      setUser(r.data.user);
      setSite(r.data.site);
    } catch (e) {
      localStorage.removeItem("pst_token");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const login = useCallback(async (email, password) => {
    const r = await api.post("/auth/login", { email, password });
    if (r.data.requires_2fa) {
      // Return the challenge; caller (Login page) will show 2FA screen.
      return { requires_2fa: true, challenge_token: r.data.challenge_token, email: r.data.email };
    }
    localStorage.setItem("pst_token", r.data.token);
    setUser(r.data.user);
    setSite(r.data.site);
    localStorage.removeItem("pst_admin_site_id");
    setAdminSiteIdState(null);
    return r.data.user;
  }, []);

  const completeLogin2FA = useCallback(async (challenge_token, code) => {
    const r = await api.post("/auth/login/2fa", { challenge_token, code });
    localStorage.setItem("pst_token", r.data.token);
    setUser(r.data.user);
    setSite(r.data.site);
    localStorage.removeItem("pst_admin_site_id");
    setAdminSiteIdState(null);
    return r.data.user;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get("/auth/me");
      setUser(r.data.user);
      setSite(r.data.site);
    } catch (e) {
      console.warn("auth.refresh failed:", e?.response?.status || e?.message);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("pst_token");
    localStorage.removeItem("pst_admin_site_id");
    setUser(null);
    setSite(null);
    setAdminSiteIdState(null);
  }, []);

  const setAdminSiteId = useCallback((sid) => {
    if (sid) {
      localStorage.setItem("pst_admin_site_id", sid);
    } else {
      localStorage.removeItem("pst_admin_site_id");
    }
    setAdminSiteIdState(sid);
  }, []);

  const isAdmin = user?.platform_role === "admin";
  const activeSiteId = isAdmin ? adminSiteId : user?.site_id;

  const value = useMemo(
    () => ({ user, site, loading, login, completeLogin2FA, refresh, logout, isAdmin, adminSiteId, setAdminSiteId, activeSiteId }),
    [user, site, loading, login, completeLogin2FA, refresh, logout, isAdmin, adminSiteId, setAdminSiteId, activeSiteId]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

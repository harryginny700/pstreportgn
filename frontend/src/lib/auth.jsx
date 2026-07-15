import { createContext, useContext, useEffect, useState, useCallback } from "react";
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

  const login = async (email, password) => {
    const r = await api.post("/auth/login", { email, password });
    localStorage.setItem("pst_token", r.data.token);
    setUser(r.data.user);
    setSite(r.data.site);
    // Reset admin site override on new login
    localStorage.removeItem("pst_admin_site_id");
    setAdminSiteIdState(null);
    return r.data.user;
  };

  const logout = () => {
    localStorage.removeItem("pst_token");
    localStorage.removeItem("pst_admin_site_id");
    setUser(null);
    setSite(null);
    setAdminSiteIdState(null);
  };

  const setAdminSiteId = (sid) => {
    if (sid) {
      localStorage.setItem("pst_admin_site_id", sid);
    } else {
      localStorage.removeItem("pst_admin_site_id");
    }
    setAdminSiteIdState(sid);
  };

  const isAdmin = user?.platform_role === "admin";
  const activeSiteId = isAdmin ? adminSiteId : user?.site_id;

  return (
    <AuthCtx.Provider value={{ user, site, loading, login, logout, isAdmin, adminSiteId, setAdminSiteId, activeSiteId }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);

import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  headers: { "Content-Type": "application/json" },
});

// Attach token from localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("pst_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Attach admin site override if in admin-viewing mode
  const siteOverride = localStorage.getItem("pst_admin_site_id");
  if (siteOverride) {
    config.params = { ...(config.params || {}), site_id: siteOverride };
  }
  return config;
});

// 401 handler: kick out to login
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem("pst_token");
      localStorage.removeItem("pst_admin_site_id");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

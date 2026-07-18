import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import DailyEntry from "@/pages/DailyEntry";
import CashRegisters from "@/pages/CashRegisters";
import Credits from "@/pages/Credits";
import Expenses from "@/pages/Expenses";
import Transfers from "@/pages/Transfers";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";
import AdminHome from "@/pages/AdminHome";
import AdminCredits from "@/pages/AdminCredits";
import ReceivedCredits from "@/pages/ReceivedCredits";
import AdminPartnerKasalar from "@/pages/AdminPartnerKasalar";
import AdminSiteCreditsSummary from "@/pages/AdminSiteCreditsSummary";
import AdminPayments from "@/pages/AdminPayments";
import AdminReport from "@/pages/AdminReport";
import Profile from "@/pages/Profile";
import Rollovers from "@/pages/Rollovers";
import { Loader2 } from "lucide-react";

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/gunluk" element={<DailyEntry />} />
        <Route path="/kasalar" element={<CashRegisters />} />
        <Route path="/krediler" element={<Credits />} />
        <Route path="/alinan-krediler" element={<ReceivedCredits />} />
        <Route path="/giderler" element={<Expenses />} />
        <Route path="/transferler" element={<Transfers />} />
        <Route path="/raporlar" element={<Reports />} />
        <Route path="/devirler" element={<Rollovers />} />
        <Route path="/ayarlar" element={<Settings />} />
        <Route path="/profil" element={<Profile />} />
        <Route path="/admin" element={<ProtectedRoute adminOnly><AdminHome /></ProtectedRoute>} />
        <Route path="/admin/krediler" element={<ProtectedRoute adminOnly><AdminCredits /></ProtectedRoute>} />
        <Route path="/admin/kasalar" element={<ProtectedRoute adminOnly><AdminPartnerKasalar /></ProtectedRoute>} />
        <Route path="/admin/site-kredileri" element={<ProtectedRoute adminOnly><AdminSiteCreditsSummary /></ProtectedRoute>} />
        <Route path="/admin/odemeler" element={<ProtectedRoute adminOnly><AdminPayments /></ProtectedRoute>} />
        <Route path="/admin/rapor" element={<ProtectedRoute adminOnly><AdminReport /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <div className="min-h-screen bg-background text-foreground">
          <BrowserRouter>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
          <ThemedToaster />
        </div>
      </ThemeProvider>
    </I18nProvider>
  );
}

function ThemedToaster() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <Toaster
      theme={isDark ? "dark" : "light"}
      position="bottom-right"
      toastOptions={{
        style: {
          background: isDark ? "hsl(0 0% 6%)" : "hsl(0 0% 100%)",
          border: isDark ? "1px solid hsl(0 0% 15%)" : "1px solid hsl(0 0% 88%)",
          color: isDark ? "white" : "hsl(0 0% 10%)",
          fontFamily: "Manrope, sans-serif",
        },
      }}
    />
  );
}

export default App;

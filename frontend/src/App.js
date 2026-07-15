import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
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
import Profile from "@/pages/Profile";
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
        <Route path="/giderler" element={<Expenses />} />
        <Route path="/transferler" element={<Transfers />} />
        <Route path="/raporlar" element={<Reports />} />
        <Route path="/ayarlar" element={<Settings />} />
        <Route path="/profil" element={<Profile />} />
        <Route path="/admin" element={<ProtectedRoute adminOnly><AdminHome /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "hsl(0 0% 6%)",
            border: "1px solid hsl(0 0% 15%)",
            color: "white",
            fontFamily: "Manrope, sans-serif",
          },
        }}
      />
    </div>
  );
}

export default App;

import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import DailyEntry from "@/pages/DailyEntry";
import CashRegisters from "@/pages/CashRegisters";
import Credits from "@/pages/Credits";
import Expenses from "@/pages/Expenses";
import Transfers from "@/pages/Transfers";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";

function App() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/gunluk" element={<DailyEntry />} />
            <Route path="/kasalar" element={<CashRegisters />} />
            <Route path="/krediler" element={<Credits />} />
            <Route path="/giderler" element={<Expenses />} />
            <Route path="/transferler" element={<Transfers />} />
            <Route path="/raporlar" element={<Reports />} />
            <Route path="/ayarlar" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
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

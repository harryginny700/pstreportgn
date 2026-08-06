import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const translations = {
  tr: {
    // Sidebar / nav
    "nav.dashboard": "Panel",
    "nav.daily": "Günlük Giriş",
    "nav.kasalar": "Kasalar",
    "nav.krediler": "Manueller",
    "nav.receivedCredits": "Alınan Krediler",
    "nav.giderler": "Giderler",
    "nav.transferler": "Transferler",
    "nav.raporlar": "Raporlar",
    "nav.devirler": "Devirler",
    "nav.ayarlar": "Ayarlar",
    "nav.admin": "Admin Paneli",
    "nav.adminCredits": "Krediler / Kurulum",
    "nav.adminKasalar": "Ortak Kasalar",
    "nav.adminSiteCredits": "Site Kredileri Özet",
    "nav.adminPayments": "Ödemeler",
    "nav.adminReport": "Rapor",
    "nav.adminBot": "Telegram Botu",
    "nav.adminSettings": "Ayarlar",
    "nav.adminScraper": "Otomatik Çekim",
    "nav.profil": "Profil & Şifre",
    "nav.logout": "Çıkış Yap",
    "nav.goToSite": "Site Paneline Git",
    "nav.backToAdmin": "Admin Paneline Dön",
    "sidebar.site": "Site",
    "sidebar.viewedSite": "İncelenen Site",
    "sidebar.selectSite": "Site seçin",
    "sidebar.brand": "PLAYSPINTECH",
    "sidebar.tagline": "iGaming · Finance",
    // Topbar
    "topbar.connected": "Bağlı",
    "topbar.selectSitePrompt": "Bir site seçin",
    "topbar.selectSiteText": "Site verilerini görüntülemek için soldaki menüden bir site seçin veya Admin Panel'e dönün.",
    "topbar.goToAdmin": "Admin Paneline Git",
    // Login
    "login.title": "Hesabınıza girin",
    "login.subtitle": "Giriş",
    "login.email": "E-posta",
    "login.password": "Şifre",
    "login.submit": "Giriş Yap",
    "login.hint": "Hesap oluşturma yetkisi sadece Playspintech admin'dedir",
    "login.brandDesc": "Yatırım, çekim, komisyon, kredi, kasa transferleri ve giderler — tüm siteler için canlı takip, günlük ve aylık raporlar, CSV çıktı.",
    "login.brandLine1": "Sitelerin",
    "login.brandLine2": "finansal kontrolü",
    "login.brandLine3": "tek panelde.",
    "login.today": "Bugünkü modül",
    "login.errRequired": "E-posta ve şifre gerekli",
    "login.errFailed": "Giriş başarısız",
    "login.welcome": "Hoş geldin",
    // Common
    "common.save": "Kaydet",
    "common.saving": "Kaydediliyor...",
    "common.add": "Ekle",
    "common.delete": "Sil",
    "common.apply": "Uygula",
    "common.cancel": "İptal",
    "common.date": "Tarih",
    "common.amount": "Tutar",
    "common.note": "Not",
    "common.total": "Toplam",
    "common.loading": "Yükleniyor...",
    "common.noData": "Kayıt yok",
    "common.confirm": "Emin misiniz?",
    "common.active": "Aktif",
    "common.inactive": "Pasif",
    // Profile
    "profile.account": "Hesap",
    "profile.info": "Profil Bilgileri",
    "profile.name": "İsim",
    "profile.email": "E-posta",
    "profile.role": "Rol",
    "profile.site": "Site",
    "profile.security": "Güvenlik",
    "profile.changePw": "Şifre Değiştir",
    "profile.currentPw": "Mevcut Şifre",
    "profile.newPw": "Yeni Şifre",
    "profile.confirmPw": "Tekrar",
    "profile.pwHint": "En az 6 karakter",
    "profile.pwChanged": "Şifreniz değiştirildi",
    "profile.admin": "Playspintech Admin",
    "profile.global": "Global",
  },
  en: {
    // Sidebar / nav
    "nav.dashboard": "Dashboard",
    "nav.daily": "Daily Entry",
    "nav.kasalar": "Cash Registers",
    "nav.krediler": "Manuals",
    "nav.receivedCredits": "Received Credits",
    "nav.giderler": "Expenses",
    "nav.transferler": "Transfers",
    "nav.raporlar": "Reports",
    "nav.devirler": "Rollovers",
    "nav.ayarlar": "Settings",
    "nav.admin": "Admin Panel",
    "nav.adminCredits": "Credits / Setup",
    "nav.adminKasalar": "Partner Kasas",
    "nav.adminSiteCredits": "Site Credits Overview",
    "nav.adminPayments": "Payments",
    "nav.adminReport": "Report",
    "nav.adminBot": "Telegram Bot",
    "nav.adminSettings": "Settings",
    "nav.adminScraper": "Auto Scraper",
    "nav.profil": "Profile & Password",
    "nav.logout": "Log Out",
    "nav.goToSite": "Go to Site Panel",
    "nav.backToAdmin": "Back to Admin Panel",
    "sidebar.site": "Site",
    "sidebar.viewedSite": "Viewing Site",
    "sidebar.selectSite": "Select site",
    "sidebar.brand": "PLAYSPINTECH",
    "sidebar.tagline": "iGaming · Finance",
    // Topbar
    "topbar.connected": "Connected",
    "topbar.selectSitePrompt": "Select a site",
    "topbar.selectSiteText": "Choose a site from the left sidebar to view its data, or return to the Admin Panel.",
    "topbar.goToAdmin": "Go to Admin Panel",
    // Login
    "login.title": "Sign in to your account",
    "login.subtitle": "Sign In",
    "login.email": "Email",
    "login.password": "Password",
    "login.submit": "Sign In",
    "login.hint": "Only Playspintech admins can create accounts",
    "login.brandDesc": "Deposits, withdrawals, commissions, credits, cash transfers and expenses — live tracking, daily and monthly reports, CSV export for all sites.",
    "login.brandLine1": "Financial control",
    "login.brandLine2": "for your sites",
    "login.brandLine3": "in one panel.",
    "login.today": "Today's module",
    "login.errRequired": "Email and password are required",
    "login.errFailed": "Sign in failed",
    "login.welcome": "Welcome",
    // Common
    "common.save": "Save",
    "common.saving": "Saving...",
    "common.add": "Add",
    "common.delete": "Delete",
    "common.apply": "Apply",
    "common.cancel": "Cancel",
    "common.date": "Date",
    "common.amount": "Amount",
    "common.note": "Note",
    "common.total": "Total",
    "common.loading": "Loading...",
    "common.noData": "No records",
    "common.confirm": "Are you sure?",
    "common.active": "Active",
    "common.inactive": "Inactive",
    // Profile
    "profile.account": "Account",
    "profile.info": "Profile Info",
    "profile.name": "Name",
    "profile.email": "Email",
    "profile.role": "Role",
    "profile.site": "Site",
    "profile.security": "Security",
    "profile.changePw": "Change Password",
    "profile.currentPw": "Current Password",
    "profile.newPw": "New Password",
    "profile.confirmPw": "Confirm",
    "profile.pwHint": "Minimum 6 characters",
    "profile.pwChanged": "Password changed",
    "profile.admin": "Playspintech Admin",
    "profile.global": "Global",
  },
};

const I18nCtx = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => {
    if (typeof window === "undefined") return "tr";
    return localStorage.getItem("pst_lang") || "tr";
  });

  useEffect(() => {
    localStorage.setItem("pst_lang", lang);
    document.documentElement.setAttribute("lang", lang);
  }, [lang]);

  const t = useCallback(
    (key, fallback) => translations[lang]?.[key] ?? translations.tr[key] ?? fallback ?? key,
    [lang]
  );
  const toggle = useCallback(() => setLang((l) => (l === "tr" ? "en" : "tr")), []);

  const value = useMemo(() => ({ lang, setLang, t, toggle }), [lang, t, toggle]);

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);

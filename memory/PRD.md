# Sahne Finance - iGaming Financial Dashboard PRD

## Original Problem Statement
Excel dosyasını modern web tabanlı finansal yönetim paneline dönüştür. iGaming sitesi için:
- Kasalar (MAKSİ, PLUS, FTN, TONY, TS, KARTAL, ALEX, KORAY)
- Ödeme yöntemleri farklı komisyonlarla (Payfix 8%, Papara 8%, Havale 9%, Kripto 2%, vb.)
- Krediciler (OKİCEY, MARDİNLİ47, KEMALGEZER, MUTOK35)
- Günlük yatırım/çekim/komisyon takibi
- Kasalar arası transfer
- Giderler / masraflar
- Günlük & aylık finansal raporlar
- Nakit akışı grafikleri

## User Choices
- Tek kullanıcılı (auth yok)
- Excel'deki tüm verileri seed
- Sadece TL
- Gelişmiş grafik + CSV export
- Modern trading terminal koyu tema (agent karar verdi)

## Architecture
- **Backend**: FastAPI + MongoDB (motor)
- **Frontend**: React 19 + Tailwind + Shadcn UI + Recharts + Sonner + lucide-react
- **Design**: Dark trading terminal (Manrope + JetBrains Mono + Space Grotesk)

## Data Model
- CashRegister (Kasa): 8 ana kasa
- PaymentMethod: 11 ödeme yöntemi (yatırım komisyon %, çekim komisyon %)
- Debtor (Kredici): 4 kişi
- Transaction: Günlük ödeme yöntemi bazlı (deposit/withdrawal/commission/net auto-calc)
- Credit: Kredici hareketleri (added/paid)
- Expense: Yapılan ödemeler / masraflar
- Transfer: Kasalar arası

## Features Implemented (2026-02)
- ✅ Dashboard: 8 KPI kartı + nakit akışı area chart + ödeme yöntemi pie chart + kasa bakiye bar chart
- ✅ Günlük Giriş: Tarih seçimli tam ödeme yöntemi tablosu, komisyon otomatik hesaplanır (Excel formülü birebir)
- ✅ Kasalar: Anlık bakiye tablosu (transactions + transfers + expenses + credits toplanır)
- ✅ Krediler: Kredici bazlı bakiye kartları + hareket formu + geçmiş
- ✅ Giderler: Ekleme + liste + kasa bağlantısı
- ✅ Transferler: Kasalar arası
- ✅ Raporlar: Aylık + günlük özet, CSV export (işlemler + rapor)
- ✅ Ayarlar: Komisyon oranı düzenleme, veri sıfırlama (reseed)
- ✅ Otomatik seed (ilk açılışta Excel yapısı yüklenir)

## Backlog (P1/P2)
- P1: Excel'den geçmiş verileri toplu import
- P1: Krediciler'de üye bazlı bakiye takibi
- P1: Kasa açılış bakiyesi düzenleme (Ayarlar → Kasalar)
- P2: AI aylık finansal özet (Claude Sonnet 4.5 - Emergent LLM Key)
- P2: Çoklu kullanıcı + rol bazlı erişim
- P2: Bildirimler (kar/zarar eşiği aşıldığında)
- P2: Excel export (xlsx formülleriyle)

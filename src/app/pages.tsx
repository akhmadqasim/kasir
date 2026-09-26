import { lazy, type ComponentType } from "react"

/**
 * Setiap halaman aplikasi, masing-masing chunk sendiri yang baru diunduh saat
 * rutenya pertama dibuka. Daftarnya dipisah dari tabel rute di `router.tsx`
 * supaya tabel itu cukup menyatakan alamat mana memuat halaman apa.
 */

/**
 * Satu ekspor bernama dari modul halaman, sebagai komponen `lazy()`.
 * `NoInfer`: nama ekspor ditentukan argumen `name`, bukan ditebak dari seluruh
 * isi modul — modulnya boleh mengekspor hal lain yang bukan komponen.
 */
function lazyPage<K extends string>(
  load: () => Promise<Record<NoInfer<K>, ComponentType>>,
  name: K,
) {
  return lazy(() => load().then((module) => ({ default: module[name] })))
}

export const OnboardingPage = lazyPage(
  () => import("@/features/onboarding/components/onboarding-page"),
  "OnboardingPage",
)
export const LoginPage = lazyPage(
  () => import("@/features/auth/components/login-page"),
  "LoginPage",
)
export const CashierPage = lazyPage(() => import("@/features/cashier"), "CashierPage")
export const ProductsPage = lazyPage(() => import("@/features/products"), "ProductsPage")
export const TransactionsPage = lazyPage(
  () => import("@/features/transactions"),
  "TransactionsPage",
)
export const RefundsPage = lazyPage(() => import("@/features/refunds"), "RefundsPage")
export const CreateRefundPage = lazyPage(() => import("@/features/refunds"), "CreateRefundPage")
// Modul halamannya langsung, bukan barrel: barrel `@/features/settings`
// mengekspor `useStoreInfo` yang dimuat eager oleh sidebar.
export const SettingsPage = lazyPage(
  () => import("@/features/settings/components/settings-page"),
  "SettingsPage",
)
export const UsersPage = lazyPage(() => import("@/features/users"), "UsersPage")
export const DashboardPage = lazyPage(() => import("@/features/dashboard"), "DashboardPage")
export const ReportsPage = lazyPage(() => import("@/features/reports"), "ReportsPage")
export const SalesDailyPage = lazyPage(
  () => import("@/features/reports/components/sales-daily-page"),
  "SalesDailyPage",
)
export const SalesMonthlyPage = lazyPage(
  () => import("@/features/reports/components/sales-monthly-page"),
  "SalesMonthlyPage",
)
export const SalesPeriodPage = lazyPage(
  () => import("@/features/reports/components/sales-period-page"),
  "SalesPeriodPage",
)
export const SalesReceiptPage = lazyPage(
  () => import("@/features/reports/components/sales-receipt-page"),
  "SalesReceiptPage",
)
export const PaymentMethodsPage = lazyPage(
  () => import("@/features/reports/components/payment-methods-page"),
  "PaymentMethodsPage",
)
export const CashFlowsPage = lazyPage(
  () => import("@/features/reports/components/cash-flows-page"),
  "CashFlowsPage",
)
export const ProductSalesPage = lazyPage(
  () => import("@/features/reports/components/product-sales-page"),
  "ProductSalesPage",
)
export const PopularProductsPage = lazyPage(
  () => import("@/features/reports/components/popular-products-page"),
  "PopularProductsPage",
)
export const ReturnsPage = lazyPage(
  () => import("@/features/reports/components/returns-page"),
  "ReturnsPage",
)
export const CurrentStockPage = lazyPage(
  () => import("@/features/reports/components/current-stock-page"),
  "CurrentStockPage",
)
export const LossesPage = lazyPage(
  () => import("@/features/reports/components/losses-page"),
  "LossesPage",
)
// Modul halamannya langsung, bukan barrel: barrel `@/features/ppob` juga
// mengekspor `PpobQuickAccess` yang dimuat kasir secara eager, jadi lewat barrel
// seluruh pohon PPOB ikut masuk chunk kasir dan batas `lazy()` ini jadi percuma.
export const PpobPage = lazyPage(() => import("@/features/ppob/components/ppob-page"), "PpobPage")
export const StockWriteoffPage = lazyPage(() => import("@/features/stock"), "StockWriteoffPage")
export const CloseShiftPage = lazyPage(
  () => import("@/features/shift/components/close-shift-page"),
  "CloseShiftPage",
)

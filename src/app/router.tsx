import { lazy, Suspense } from "react"
import { createHashRouter, Navigate, RouterProvider } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { AppGuard } from "./app-guard"
import { AppLayout } from "./app-layout"

const OnboardingPage = lazy(() => import("@/features/onboarding/components/onboarding-page").then(m => ({ default: m.OnboardingPage })))
const LoginPage = lazy(() => import("@/features/auth/components/login-page").then(m => ({ default: m.LoginPage })))
const CashierPage = lazy(() => import("@/features/cashier").then(m => ({ default: m.CashierPage })))
const ProductsPage = lazy(() => import("@/features/products").then(m => ({ default: m.ProductsPage })))
const TransactionsPage = lazy(() => import("@/features/transactions").then(m => ({ default: m.TransactionsPage })))
const RefundsPage = lazy(() => import("@/features/refunds").then(m => ({ default: m.RefundsPage })))
const CreateRefundPage = lazy(() => import("@/features/refunds").then(m => ({ default: m.CreateRefundPage })))
const SettingsPage = lazy(() => import("@/features/settings").then(m => ({ default: m.SettingsPage })))
const UsersPage = lazy(() => import("@/features/users").then(m => ({ default: m.UsersPage })))
const DashboardPage = lazy(() => import("@/features/dashboard").then(m => ({ default: m.DashboardPage })))
const ReportsPage = lazy(() => import("@/features/reports").then(m => ({ default: m.ReportsPage })))
const SalesDailyPage = lazy(() => import("@/features/reports/components/sales-daily-page").then(m => ({ default: m.SalesDailyPage })))
const SalesMonthlyPage = lazy(() => import("@/features/reports/components/sales-monthly-page").then(m => ({ default: m.SalesMonthlyPage })))
const SalesPeriodPage = lazy(() => import("@/features/reports/components/sales-period-page").then(m => ({ default: m.SalesPeriodPage })))
const SalesReceiptPage = lazy(() => import("@/features/reports/components/sales-receipt-page").then(m => ({ default: m.SalesReceiptPage })))
const PaymentMethodsPage = lazy(() => import("@/features/reports/components/payment-methods-page").then(m => ({ default: m.PaymentMethodsPage })))
const ProductSalesPage = lazy(() => import("@/features/reports/components/product-sales-page").then(m => ({ default: m.ProductSalesPage })))
const PopularProductsPage = lazy(() => import("@/features/reports/components/popular-products-page").then(m => ({ default: m.PopularProductsPage })))
const ReturnsPage = lazy(() => import("@/features/reports/components/returns-page").then(m => ({ default: m.ReturnsPage })))
const CurrentStockPage = lazy(() => import("@/features/reports/components/current-stock-page").then(m => ({ default: m.CurrentStockPage })))
const LossesPage = lazy(() => import("@/features/reports/components/losses-page").then(m => ({ default: m.LossesPage })))
const PpobPage = lazy(() => import("@/features/ppob").then(m => ({ default: m.PpobPage })))
const CloseShiftPage = lazy(() => import("@/features/shift/components/close-shift-page").then(m => ({ default: m.CloseShiftPage })))

function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

const router = createHashRouter([
  {
    path: "/onboarding",
    element: <LazyPage><OnboardingPage /></LazyPage>,
  },
  {
    path: "/login",
    element: <LazyPage><LoginPage /></LazyPage>,
  },
  {
    path: "/",
    element: <AppGuard />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: <Navigate to="/dashboard" replace />,
          },
          {
            path: "cashier",
            element: <LazyPage><CashierPage /></LazyPage>,
          },
          {
            path: "close-shift",
            element: <LazyPage><CloseShiftPage /></LazyPage>,
          },
          {
            path: "dashboard",
            element: <LazyPage><DashboardPage /></LazyPage>,
          },
          {
            path: "ppob/*",
            element: <LazyPage><PpobPage /></LazyPage>,
          },
          {
            path: "products",
            element: <LazyPage><ProductsPage /></LazyPage>,
          },
          {
            path: "transactions",
            element: <LazyPage><TransactionsPage /></LazyPage>,
          },
          {
            path: "refunds",
            element: <LazyPage><RefundsPage /></LazyPage>,
          },
          {
            path: "refund/:transactionId",
            element: <LazyPage><CreateRefundPage /></LazyPage>,
          },
          {
            path: "stock",
            element: (
              <div className="p-8">
                <h1 className="text-2xl font-bold">Stok Write-off</h1>
                <p className="text-muted-foreground">Coming soon...</p>
              </div>
            ),
          },
          {
            path: "reports",
            element: <LazyPage><ReportsPage /></LazyPage>,
            children: [
              { path: "sales-daily", element: <LazyPage><SalesDailyPage /></LazyPage> },
              { path: "sales-monthly", element: <LazyPage><SalesMonthlyPage /></LazyPage> },
              { path: "sales-period", element: <LazyPage><SalesPeriodPage /></LazyPage> },
              { path: "sales-receipt", element: <LazyPage><SalesReceiptPage /></LazyPage> },
              { path: "payment-methods", element: <LazyPage><PaymentMethodsPage /></LazyPage> },
              { path: "product-sales", element: <LazyPage><ProductSalesPage /></LazyPage> },
              { path: "popular-products", element: <LazyPage><PopularProductsPage /></LazyPage> },
              { path: "returns", element: <LazyPage><ReturnsPage /></LazyPage> },
              { path: "current-stock", element: <LazyPage><CurrentStockPage /></LazyPage> },
              { path: "losses", element: <LazyPage><LossesPage /></LazyPage> },
            ],
          },
          {
            path: "settings",
            element: <LazyPage><SettingsPage /></LazyPage>,
          },
          {
            path: "users",
            element: <LazyPage><UsersPage /></LazyPage>,
          },
        ],
      },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}

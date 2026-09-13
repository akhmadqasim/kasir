import { lazy, Suspense } from "react"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom"
import { Spinner } from "@heroui/react"
import { AdminRouteGuard, AppGuard } from "./app-guard"
import { AppLayout } from "./app-layout"
import { readStoredResumeRoute, resolveResumeRoute } from "./resume-route"
import { RouteErrorPage } from "./route-error-page"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"

const OnboardingPage = lazy(() =>
  import("@/features/onboarding/components/onboarding-page").then((m) => ({
    default: m.OnboardingPage,
  })),
)
const LoginPage = lazy(() =>
  import("@/features/auth/components/login-page").then((m) => ({ default: m.LoginPage })),
)
const CashierPage = lazy(() =>
  import("@/features/cashier").then((m) => ({ default: m.CashierPage })),
)
const ProductsPage = lazy(() =>
  import("@/features/products").then((m) => ({ default: m.ProductsPage })),
)
const TransactionsPage = lazy(() =>
  import("@/features/transactions").then((m) => ({ default: m.TransactionsPage })),
)
const RefundsPage = lazy(() =>
  import("@/features/refunds").then((m) => ({ default: m.RefundsPage })),
)
const CreateRefundPage = lazy(() =>
  import("@/features/refunds").then((m) => ({ default: m.CreateRefundPage })),
)
const SettingsPage = lazy(() =>
  // Modul halamannya langsung, bukan barrel: barrel `@/features/settings`
  // mengekspor `useStoreInfo` yang dimuat eager oleh sidebar.
  import("@/features/settings/components/settings-page").then((m) => ({ default: m.SettingsPage })),
)
const UsersPage = lazy(() => import("@/features/users").then((m) => ({ default: m.UsersPage })))
const DashboardPage = lazy(() =>
  import("@/features/dashboard").then((m) => ({ default: m.DashboardPage })),
)
const ReportsPage = lazy(() =>
  import("@/features/reports").then((m) => ({ default: m.ReportsPage })),
)
const SalesDailyPage = lazy(() =>
  import("@/features/reports/components/sales-daily-page").then((m) => ({
    default: m.SalesDailyPage,
  })),
)
const SalesMonthlyPage = lazy(() =>
  import("@/features/reports/components/sales-monthly-page").then((m) => ({
    default: m.SalesMonthlyPage,
  })),
)
const SalesPeriodPage = lazy(() =>
  import("@/features/reports/components/sales-period-page").then((m) => ({
    default: m.SalesPeriodPage,
  })),
)
const SalesReceiptPage = lazy(() =>
  import("@/features/reports/components/sales-receipt-page").then((m) => ({
    default: m.SalesReceiptPage,
  })),
)
const PaymentMethodsPage = lazy(() =>
  import("@/features/reports/components/payment-methods-page").then((m) => ({
    default: m.PaymentMethodsPage,
  })),
)
const CashFlowsPage = lazy(() =>
  import("@/features/reports/components/cash-flows-page").then((m) => ({
    default: m.CashFlowsPage,
  })),
)
const ProductSalesPage = lazy(() =>
  import("@/features/reports/components/product-sales-page").then((m) => ({
    default: m.ProductSalesPage,
  })),
)
const PopularProductsPage = lazy(() =>
  import("@/features/reports/components/popular-products-page").then((m) => ({
    default: m.PopularProductsPage,
  })),
)
const ReturnsPage = lazy(() =>
  import("@/features/reports/components/returns-page").then((m) => ({ default: m.ReturnsPage })),
)
const CurrentStockPage = lazy(() =>
  import("@/features/reports/components/current-stock-page").then((m) => ({
    default: m.CurrentStockPage,
  })),
)
const LossesPage = lazy(() =>
  import("@/features/reports/components/losses-page").then((m) => ({ default: m.LossesPage })),
)
// Modul halamannya langsung, bukan barrel: barrel `@/features/ppob` juga
// mengekspor `PpobQuickAccess` yang dimuat kasir secara eager, jadi lewat barrel
// seluruh pohon PPOB ikut masuk chunk kasir dan batas `lazy()` ini jadi percuma.
const PpobPage = lazy(() =>
  import("@/features/ppob/components/ppob-page").then((m) => ({ default: m.PpobPage })),
)
const StockWriteoffPage = lazy(() =>
  import("@/features/stock").then((m) => ({ default: m.StockWriteoffPage })),
)
const CloseShiftPage = lazy(() =>
  import("@/features/shift/components/close-shift-page").then((m) => ({
    default: m.CloseShiftPage,
  })),
)

function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner aria-label="Memuat halaman" color="current" size="lg" className="text-muted" />
    </div>
  )
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

function ResumeRedirect() {
  const user = useAuthStore((s) => s.user)

  if (!user) {
    return <Navigate to="/login" replace />
  }

  const target = resolveResumeRoute(user.role, readStoredResumeRoute())
  return <Navigate to={target} replace />
}

/**
 * Alamat yang tidak cocok dengan rute mana pun. Loader-nya melempar 404 supaya
 * `RouteErrorPage` di rute ini yang menggambarnya — di dalam `AppLayout`, jadi
 * sidebar tetap ada dan pengguna bisa langsung pindah halaman.
 */
function throwNotFound(): never {
  throw new Response(null, { status: 404, statusText: "Not Found" })
}

/** Hanya di `bun run dev`: buka `/__error` untuk melihat halaman error tanpa merusak apa pun. */
function CrashForQa(): never {
  throw new Error("Contoh kesalahan dari /__error untuk menguji halaman error")
}

const router = createBrowserRouter([
  {
    // Rute tanpa path di puncak: satu errorElement untuk apa pun yang jatuh di
    // luar halaman — guard, layout, layar login/onboarding, dan alamat yang
    // tidak cocok sama sekali. Halaman di dalam AppLayout punya penangkap
    // sendiri di bawah supaya sidebar tidak ikut hilang.
    errorElement: <RouteErrorPage />,
    children: [
      {
        path: "/onboarding",
        element: (
          <LazyPage>
            <OnboardingPage />
          </LazyPage>
        ),
      },
      {
        path: "/login",
        element: (
          <LazyPage>
            <LoginPage />
          </LazyPage>
        ),
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
                element: <ResumeRedirect />,
              },
              {
                // Rute tanpa path: hanya untuk memasang errorElement yang dirender
                // di tempat halaman, di dalam Outlet AppLayout.
                errorElement: <RouteErrorPage />,
                children: [
                  ...(import.meta.env.DEV ? [{ path: "__error", element: <CrashForQa /> }] : []),
                  {
                    path: "cashier",
                    element: (
                      <LazyPage>
                        <CashierPage />
                      </LazyPage>
                    ),
                  },
                  {
                    path: "close-shift",
                    element: (
                      <LazyPage>
                        <CloseShiftPage />
                      </LazyPage>
                    ),
                  },
                  {
                    path: "dashboard",
                    element: (
                      <LazyPage>
                        <DashboardPage />
                      </LazyPage>
                    ),
                  },
                  {
                    path: "ppob/*",
                    element: (
                      <LazyPage>
                        <PpobPage />
                      </LazyPage>
                    ),
                  },
                  {
                    path: "transactions",
                    element: (
                      <LazyPage>
                        <TransactionsPage />
                      </LazyPage>
                    ),
                  },
                  {
                    path: "refunds",
                    element: (
                      <LazyPage>
                        <RefundsPage />
                      </LazyPage>
                    ),
                  },
                  {
                    path: "refund/:transactionId",
                    element: (
                      <LazyPage>
                        <CreateRefundPage />
                      </LazyPage>
                    ),
                  },
                  {
                    path: "stock",
                    element: (
                      <LazyPage>
                        <StockWriteoffPage />
                      </LazyPage>
                    ),
                  },
                  {
                    path: "reports",
                    element: (
                      <LazyPage>
                        <ReportsPage />
                      </LazyPage>
                    ),
                    children: [
                      {
                        path: "sales-daily",
                        element: (
                          <LazyPage>
                            <SalesDailyPage />
                          </LazyPage>
                        ),
                      },
                      {
                        path: "sales-monthly",
                        element: (
                          <LazyPage>
                            <SalesMonthlyPage />
                          </LazyPage>
                        ),
                      },
                      {
                        path: "sales-period",
                        element: (
                          <LazyPage>
                            <SalesPeriodPage />
                          </LazyPage>
                        ),
                      },
                      {
                        path: "sales-receipt",
                        element: (
                          <LazyPage>
                            <SalesReceiptPage />
                          </LazyPage>
                        ),
                      },
                      {
                        path: "payment-methods",
                        element: (
                          <LazyPage>
                            <PaymentMethodsPage />
                          </LazyPage>
                        ),
                      },
                      {
                        path: "cash-flows",
                        element: (
                          <LazyPage>
                            <CashFlowsPage />
                          </LazyPage>
                        ),
                      },
                      {
                        path: "product-sales",
                        element: (
                          <LazyPage>
                            <ProductSalesPage />
                          </LazyPage>
                        ),
                      },
                      {
                        path: "popular-products",
                        element: (
                          <LazyPage>
                            <PopularProductsPage />
                          </LazyPage>
                        ),
                      },
                      {
                        path: "returns",
                        element: (
                          <LazyPage>
                            <ReturnsPage />
                          </LazyPage>
                        ),
                      },
                      {
                        path: "current-stock",
                        element: (
                          <LazyPage>
                            <CurrentStockPage />
                          </LazyPage>
                        ),
                      },
                      {
                        path: "losses",
                        element: (
                          <LazyPage>
                            <LossesPage />
                          </LazyPage>
                        ),
                      },
                    ],
                  },
                  {
                    // Screens whose commands are admin-only in the Rust layer.
                    element: <AdminRouteGuard />,
                    children: [
                      {
                        path: "products",
                        element: (
                          <LazyPage>
                            <ProductsPage />
                          </LazyPage>
                        ),
                      },
                      {
                        path: "settings",
                        element: (
                          <LazyPage>
                            <SettingsPage />
                          </LazyPage>
                        ),
                      },
                      {
                        path: "users",
                        element: (
                          <LazyPage>
                            <UsersPage />
                          </LazyPage>
                        ),
                      },
                    ],
                  },
                  {
                    path: "*",
                    loader: throwNotFound,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}

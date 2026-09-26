import { Suspense, type ComponentType } from "react"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom"
import { Spinner } from "@heroui/react"
import { AdminRouteGuard, AppGuard } from "./app-guard"
import { AppLayout } from "./app-layout"
import * as Pages from "./pages"
import { readStoredResumeRoute, resolveResumeRoute } from "./resume-route"
import { RouteErrorPage } from "./route-error-page"
import { SuccessDialogForQa } from "./qa-success-dialog"
import { useAuthStore } from "@/features/auth"

function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner aria-label="Memuat halaman" color="current" size="lg" className="text-muted" />
    </div>
  )
}

/** Elemen rute untuk halaman `lazy()`: spinner sampai chunk-nya selesai dimuat. */
function page(Page: ComponentType) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Page />
    </Suspense>
  )
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
      { path: "/onboarding", element: page(Pages.OnboardingPage) },
      { path: "/login", element: page(Pages.LoginPage) },
      {
        path: "/",
        element: <AppGuard />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <ResumeRedirect /> },
              {
                // Rute tanpa path: hanya untuk memasang errorElement yang dirender
                // di tempat halaman, di dalam Outlet AppLayout.
                errorElement: <RouteErrorPage />,
                children: [
                  ...(import.meta.env.DEV
                    ? [
                        { path: "__error", element: <CrashForQa /> },
                        { path: "__success", element: <SuccessDialogForQa /> },
                      ]
                    : []),
                  { path: "cashier", element: page(Pages.CashierPage) },
                  { path: "close-shift", element: page(Pages.CloseShiftPage) },
                  { path: "dashboard", element: page(Pages.DashboardPage) },
                  { path: "ppob/*", element: page(Pages.PpobPage) },
                  { path: "transactions", element: page(Pages.TransactionsPage) },
                  { path: "refunds", element: page(Pages.RefundsPage) },
                  { path: "refund/:transactionId", element: page(Pages.CreateRefundPage) },
                  { path: "stock", element: page(Pages.StockWriteoffPage) },
                  {
                    path: "reports",
                    element: page(Pages.ReportsPage),
                    children: [
                      { path: "sales-daily", element: page(Pages.SalesDailyPage) },
                      { path: "sales-monthly", element: page(Pages.SalesMonthlyPage) },
                      { path: "sales-period", element: page(Pages.SalesPeriodPage) },
                      { path: "sales-receipt", element: page(Pages.SalesReceiptPage) },
                      { path: "payment-methods", element: page(Pages.PaymentMethodsPage) },
                      { path: "cash-flows", element: page(Pages.CashFlowsPage) },
                      { path: "product-sales", element: page(Pages.ProductSalesPage) },
                      { path: "popular-products", element: page(Pages.PopularProductsPage) },
                      { path: "returns", element: page(Pages.ReturnsPage) },
                      { path: "current-stock", element: page(Pages.CurrentStockPage) },
                      { path: "losses", element: page(Pages.LossesPage) },
                    ],
                  },
                  {
                    // Screens whose commands are admin-only in the Rust layer.
                    element: <AdminRouteGuard />,
                    children: [
                      { path: "products", element: page(Pages.ProductsPage) },
                      { path: "settings", element: page(Pages.SettingsPage) },
                      { path: "users", element: page(Pages.UsersPage) },
                    ],
                  },
                  { path: "*", loader: throwNotFound },
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

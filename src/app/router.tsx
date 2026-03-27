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
const PpobPage = lazy(() => import("@/features/ppob").then(m => ({ default: m.PpobPage })))

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
            element: <Navigate to="/cashier" replace />,
          },
          {
            path: "cashier",
            element: <LazyPage><CashierPage /></LazyPage>,
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
            element: (
              <div className="p-8">
                <h1 className="text-2xl font-bold">Laporan</h1>
                <p className="text-muted-foreground">Coming soon...</p>
              </div>
            ),
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

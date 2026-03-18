import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom"
import { OnboardingPage } from "@/features/onboarding/components/onboarding-page"
import { LoginPage } from "@/features/auth/components/login-page"
import { ProductsPage } from "@/features/products"
import { AppGuard } from "./app-guard"
import { AppLayout } from "./app-layout"

const router = createBrowserRouter([
  {
    path: "/onboarding",
    element: <OnboardingPage />,
  },
  {
    path: "/login",
    element: <LoginPage />,
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
            element: (
              <div className="p-8">
                <h1 className="text-2xl font-bold">Kasir</h1>
                <p className="text-muted-foreground">Coming soon...</p>
              </div>
            ),
          },
          {
            path: "products",
            element: <ProductsPage />,
          },
          {
            path: "transactions",
            element: (
              <div className="p-8">
                <h1 className="text-2xl font-bold">Riwayat Transaksi</h1>
                <p className="text-muted-foreground">Coming soon...</p>
              </div>
            ),
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
            element: (
              <div className="p-8">
                <h1 className="text-2xl font-bold">Pengaturan</h1>
                <p className="text-muted-foreground">Coming soon...</p>
              </div>
            ),
          },
          {
            path: "users",
            element: (
              <div className="p-8">
                <h1 className="text-2xl font-bold">Manajemen User</h1>
                <p className="text-muted-foreground">Coming soon...</p>
              </div>
            ),
          },
        ],
      },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}

import { createBrowserRouter, RouterProvider } from "react-router-dom"
import { OnboardingPage } from "@/features/onboarding/components/onboarding-page"
import { AppGuard } from "./app-guard"

const router = createBrowserRouter([
  {
    path: "/onboarding",
    element: <OnboardingPage />,
  },
  {
    path: "/login",
    element: (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Login Page (Coming Soon)</p>
      </div>
    ),
  },
  {
    path: "/",
    element: <AppGuard />,
    children: [
      {
        index: true,
        element: (
          <div className="p-8">
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p>Coming soon...</p>
          </div>
        ),
      },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}

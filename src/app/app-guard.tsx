import { Navigate, Outlet, useLocation } from "react-router-dom"
import { Spinner } from "@heroui/react"
import { useCheckOnboarding } from "@/features/onboarding/hooks/use-onboarding"
import { useAuthStore, useAuthHydrated } from "@/features/auth/hooks/use-auth-store"
import { getDefaultRouteForRole, isAdminOnlyRoute } from "./resume-route"

export function AppGuard() {
  const { needsOnboarding, isLoading } = useCheckOnboarding()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasHydrated = useAuthHydrated()

  if (isLoading || !hasHydrated) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3">
        <Spinner aria-label="Memuat aplikasi" color="current" size="lg" className="text-muted" />
        <p className="text-sm text-muted">Memuat...</p>
      </div>
    )
  }

  if (needsOnboarding) {
    return <Navigate to="/onboarding" replace />
  }

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

/**
 * Route-level counterpart to the backend's `require_role(.., "admin")`. Without it a
 * cashier reaches admin screens through the stored resume route or a typed hash URL,
 * fills in a whole form, and is only rejected when the command runs.
 */
export function AdminRouteGuard() {
  const user = useAuthStore((s) => s.user)
  const location = useLocation()

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (user.role !== "admin" && isAdminOnlyRoute(location.pathname)) {
    return <Navigate to={getDefaultRouteForRole(user.role)} replace />
  }

  return <Outlet />
}

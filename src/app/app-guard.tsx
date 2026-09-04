import { Navigate, Outlet, useLocation } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { useCheckOnboarding } from "@/features/onboarding/hooks/use-onboarding"
import { useAuthStore, useAuthHydrated } from "@/features/auth/hooks/use-auth-store"
import { getDefaultRouteForRole, isAdminOnlyRoute } from "./resume-route"

export function AppGuard() {
  const { needsOnboarding, isLoading } = useCheckOnboarding()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasHydrated = useAuthHydrated()

  if (isLoading || !hasHydrated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Memuat...</p>
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

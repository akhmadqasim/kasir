import { Navigate, Outlet, useLocation } from "react-router-dom"
import { Spinner } from "@heroui/react"
import { useCheckOnboarding } from "@/features/onboarding/hooks/use-onboarding"
import { useCurrentUser } from "@/features/auth/hooks/use-auth"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { getDefaultRouteForRole, isAdminOnlyRoute } from "./resume-route"

/**
 * The gate every screen sits behind.
 *
 * Identity comes from `GET /api/auth/me`, not from `localStorage`. That is the
 * whole change: the app used to boot from a persisted `User` and only find out
 * the session was gone when something failed. Now it asks first, and a 401 from
 * anywhere later clears the same answer — which lands the user right here, on
 * the way to the login screen, without anything having to navigate.
 */
export function AppGuard() {
  const { needsOnboarding, isLoading } = useCheckOnboarding()
  const session = useCurrentUser()
  const user = useAuthStore((state) => state.user)

  if (isLoading || session.isPending) {
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

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

/**
 * Route-level counterpart to the backend's `require_admin`. Without it a cashier
 * reaches admin screens through the stored resume route or a typed URL, fills in
 * a whole form, and is only rejected when the request runs.
 *
 * The role behind this check now comes from the server rather than from a
 * `localStorage` entry the user could edit, so it is a courtesy to the cashier
 * rather than the thing standing between them and an admin action.
 */
export function AdminRouteGuard() {
  const user = useAuthStore((state) => state.user)
  const location = useLocation()

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (user.role !== "admin" && isAdminOnlyRoute(location.pathname)) {
    return <Navigate to={getDefaultRouteForRole(user.role)} replace />
  }

  return <Outlet />
}

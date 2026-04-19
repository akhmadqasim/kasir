import { useEffect } from "react"
import { Navigate, Outlet } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { useCheckOnboarding } from "@/features/onboarding/hooks/use-onboarding"
import { useAuthStore, useAuthHydrated } from "@/features/auth/hooks/use-auth-store"
import { logger } from "@/lib/startup-logger"

export function AppGuard() {
  const { needsOnboarding, isLoading } = useCheckOnboarding()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasHydrated = useAuthHydrated()

  useEffect(() => {
    logger.startup(
      `AppGuard state: isLoading=${isLoading}, hasHydrated=${hasHydrated}, needsOnboarding=${needsOnboarding}, isAuthenticated=${isAuthenticated()}`
    )
  }, [isLoading, hasHydrated, needsOnboarding, isAuthenticated])

  if (isLoading || !hasHydrated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Memuat...</p>
      </div>
    )
  }

  if (needsOnboarding) {
    logger.startup("Navigating to /onboarding")
    return <Navigate to="/onboarding" replace />
  }

  if (!isAuthenticated()) {
    logger.startup("Navigating to /login")
    return <Navigate to="/login" replace />
  }

  logger.startup("AppGuard passed — rendering authenticated content")
  return <Outlet />
}

import { Navigate, Outlet } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { useCheckOnboarding } from "@/features/onboarding/hooks/use-onboarding"
import { useAuthStore, useAuthHydrated } from "@/features/auth/hooks/use-auth-store"

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

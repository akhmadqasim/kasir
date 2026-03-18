import { Navigate, Outlet } from "react-router-dom"
import { useCheckOnboarding } from "@/features/onboarding/hooks/use-onboarding"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"

export function AppGuard() {
  const { needsOnboarding, isLoading } = useCheckOnboarding()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-muted-foreground">Memuat...</p>
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

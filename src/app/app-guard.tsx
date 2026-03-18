import { Navigate, Outlet } from "react-router-dom"
import { useCheckOnboarding } from "@/features/onboarding/hooks/use-onboarding"

export function AppGuard() {
  const { needsOnboarding, isLoading } = useCheckOnboarding()

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

  return <Outlet />
}

import { Navigate, Outlet, useLocation } from "react-router-dom"

export function ReportsPage() {
  const location = useLocation()

  // If at /reports exactly, redirect to first report
  if (location.pathname === "/reports" || location.pathname === "/reports/") {
    return <Navigate to="/reports/sales-daily" replace />
  }

  return <Outlet />
}

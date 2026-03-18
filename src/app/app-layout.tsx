import { useEffect } from "react"
import { Outlet, NavLink, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  ShoppingCart,
  Package,
  History,
  FileWarning,
  BarChart3,
  Settings,
  Users,
  LogOut,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"

const navItems = [
  { to: "/cashier", icon: ShoppingCart, label: id.nav.cashier },
  { to: "/products", icon: Package, label: id.nav.products },
  { to: "/transactions", icon: History, label: id.nav.transactions },
  { to: "/stock", icon: FileWarning, label: id.nav.stock },
  { to: "/reports", icon: BarChart3, label: id.nav.reports },
]

const adminNavItems = [
  { to: "/settings", icon: Settings, label: id.nav.settings },
  { to: "/users", icon: Users, label: id.nav.users },
]

export function AppLayout() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const updateActivity = useAuthStore((s) => s.updateActivity)
  const checkTimeout = useAuthStore((s) => s.checkTimeout)
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate("/login")
  }

  // Session timeout check
  useEffect(() => {
    const interval = setInterval(() => {
      if (checkTimeout()) {
        toast.error(id.auth.sessionExpired)
        navigate("/login")
      }
    }, 60_000)
    return () => clearInterval(interval)
  }, [checkTimeout, navigate])

  // Track user activity
  useEffect(() => {
    const handler = () => updateActivity()
    document.addEventListener("click", handler)
    document.addEventListener("keypress", handler)
    return () => {
      document.removeEventListener("click", handler)
      document.removeEventListener("keypress", handler)
    }
  }, [updateActivity])

  const isAdmin = user?.role === "admin"

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white flex flex-col">
        <div className="p-4">
          <h1 className="text-lg font-bold">{id.app.name}</h1>
        </div>
        <Separator className="bg-gray-700" />

        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-gray-700 text-white"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}

          {isAdmin && (
            <>
              <Separator className="bg-gray-700 my-2" />
              {adminNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                      isActive
                        ? "bg-gray-700 text-white"
                        : "text-gray-300 hover:bg-gray-800 hover:text-white"
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <Separator className="bg-gray-700" />
        <div className="p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">{user?.full_name}</p>
            <p className="text-xs text-gray-400 capitalize">{user?.role}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-gray-300 hover:text-white hover:bg-gray-800"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4 mr-2" />
            {id.auth.logout}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50">
        <Outlet />
      </main>
    </div>
  )
}

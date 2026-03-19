import { useEffect, useState } from "react"
import { Outlet, useNavigate, useLocation } from "react-router-dom"
import { toast } from "sonner"
import { Separator } from "@/components/ui/separator"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { AppSidebar } from "@/components/app-sidebar"

const pageLabelMap: Record<string, string> = {
  "/cashier": id.nav.cashier,
  "/products": id.nav.products,
  "/transactions": id.nav.transactions,
  "/stock": id.nav.stock,
  "/reports": id.nav.reports,
  "/settings": id.nav.settings,
  "/users": id.nav.users,
}

export type SidebarMode = "full" | "icon" | "hidden"

const SIDEBAR_MODE_KEY = "kasir-sidebar-mode"

function getInitialMode(): SidebarMode {
  const stored = localStorage.getItem(SIDEBAR_MODE_KEY)
  if (stored === "full" || stored === "icon" || stored === "hidden") return stored
  return "full"
}

export function AppLayout() {
  const updateActivity = useAuthStore((s) => s.updateActivity)
  const checkTimeout = useAuthStore((s) => s.checkTimeout)
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(getInitialMode)

  const cycleSidebarMode = () => {
    setSidebarMode((prev) => {
      const next = prev === "full" ? "icon" : prev === "icon" ? "hidden" : "full"
      localStorage.setItem(SIDEBAR_MODE_KEY, next)
      return next
    })
  }

  // Session timeout check (every 5 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      if (checkTimeout()) {
        toast.error(id.auth.sessionExpired)
        navigate("/login")
      }
    }, 5 * 60_000)
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

  // Keyboard shortcut: Ctrl+B to cycle sidebar mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        cycleSidebarMode()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  return (
    <SidebarProvider
      className="h-svh !min-h-0 overflow-hidden"
      open={sidebarMode === "full"}
      onOpenChange={() => {
        // Prevent default toggle — we handle cycling ourselves
      }}
    >
      <AppSidebar collapsible={sidebarMode === "hidden" ? "offcanvas" : "icon"} />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" onClick={(e) => {
              e.preventDefault()
              cycleSidebarMode()
            }} />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>
                    {pageLabelMap[location.pathname] ?? id.app.name}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 pt-0">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

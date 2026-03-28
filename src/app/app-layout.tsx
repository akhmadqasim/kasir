import { useEffect, useState } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { AppSidebar } from "@/components/app-sidebar"

const SIDEBAR_OPEN_KEY = "kasir-sidebar-open"

function getInitialOpen(): boolean {
  const stored = localStorage.getItem(SIDEBAR_OPEN_KEY)
  if (stored === "false") return false
  return true
}

export function AppLayout() {
  const updateActivity = useAuthStore((s) => s.updateActivity)
  const checkTimeout = useAuthStore((s) => s.checkTimeout)
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(getInitialOpen)

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev
      localStorage.setItem(SIDEBAR_OPEN_KEY, String(next))
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

  // Keyboard shortcut: Ctrl+B to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  return (
    <SidebarProvider
      className="h-svh !min-h-0 overflow-hidden"
      open={sidebarOpen}
      onOpenChange={(open) => {
        setSidebarOpen(open)
        localStorage.setItem(SIDEBAR_OPEN_KEY, String(open))
      }}
    >
      <AppSidebar collapsible="icon" />
      <SidebarInset>
        <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

import { useEffect, useState } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Menu, Minus, Plus } from "lucide-react"
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { AppSidebar } from "@/components/app-sidebar"

const SIDEBAR_OPEN_KEY = "kasir-sidebar-open"
const ZOOM_LEVEL_KEY = "kasir-zoom-level"
const AUTO_COLLAPSE_WIDTH = 1280
const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.0

function getInitialOpen(): boolean {
  if (window.innerWidth < AUTO_COLLAPSE_WIDTH) return false
  const stored = localStorage.getItem(SIDEBAR_OPEN_KEY)
  if (stored === "false") return false
  return true
}

function getInitialZoom(): number {
  const stored = localStorage.getItem(ZOOM_LEVEL_KEY)
  if (stored) {
    const val = parseFloat(stored)
    if (!isNaN(val) && val >= ZOOM_MIN && val <= ZOOM_MAX) return val
  }
  return 1.0
}

export function AppLayout() {
  const updateActivity = useAuthStore((s) => s.updateActivity)
  const checkTimeout = useAuthStore((s) => s.checkTimeout)
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(getInitialOpen)
  const [autoCollapsed, setAutoCollapsed] = useState(
    () => window.innerWidth < AUTO_COLLAPSE_WIDTH
  )
  const [zoom, setZoom] = useState(getInitialZoom)

  // Apply zoom level
  useEffect(() => {
    document.documentElement.style.zoom = String(zoom)
    localStorage.setItem(ZOOM_LEVEL_KEY, String(zoom))
  }, [zoom])

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

  // Auto-collapse sidebar on small windows
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${AUTO_COLLAPSE_WIDTH - 1}px)`)

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches && sidebarOpen) {
        setSidebarOpen(false)
        setAutoCollapsed(true)
      } else if (!e.matches && autoCollapsed) {
        const stored = localStorage.getItem(SIDEBAR_OPEN_KEY)
        setSidebarOpen(stored !== "false")
        setAutoCollapsed(false)
      }
    }

    handleChange(mql)
    mql.addEventListener("change", handleChange)
    return () => mql.removeEventListener("change", handleChange)
  }, [sidebarOpen, autoCollapsed])

  // Keyboard shortcuts: Ctrl+B (sidebar), Ctrl+/- (zoom), Ctrl+0 (reset zoom)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return

      if (e.key === "b") {
        e.preventDefault()
        toggleSidebar()
      } else if (e.key === "=" || e.key === "+") {
        e.preventDefault()
        setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 10) / 10))
      } else if (e.key === "-") {
        e.preventDefault()
        setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 10) / 10))
      } else if (e.key === "0") {
        e.preventDefault()
        setZoom(1.0)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  return (
    <SidebarProvider
      className="!min-h-0 overflow-hidden"
      style={{ height: `calc(100svh / ${zoom})` }}
      open={sidebarOpen}
      onOpenChange={(open) => {
        setSidebarOpen(open)
        setAutoCollapsed(false)
        localStorage.setItem(SIDEBAR_OPEN_KEY, String(open))
      }}
    >
      <AppSidebar collapsible="icon" style={{ height: `calc(100svh / ${zoom})` }} />
      <SidebarInset>
        <MobileToolbar
          zoom={zoom}
          zoomIn={() => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 10) / 10))}
          zoomOut={() => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 10) / 10))}
          zoomReset={() => setZoom(1.0)}
          zoomMin={ZOOM_MIN}
          zoomMax={ZOOM_MAX}
        />
        <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 pb-16 lg:pb-4">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

interface MobileToolbarProps {
  zoom: number
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  zoomMin: number
  zoomMax: number
}

function MobileToolbar({ zoom, zoomIn, zoomOut, zoomReset, zoomMin, zoomMax }: MobileToolbarProps) {
  const { toggleSidebar, isMobile } = useSidebar()

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 flex items-center justify-between lg:hidden">
      {isMobile ? (
        <Button
          variant="outline"
          size="icon-sm"
          className="h-8 w-8 shadow-sm backdrop-blur md:hidden"
          onClick={toggleSidebar}
        >
          <Menu className="h-4 w-4" />
        </Button>
      ) : (
        <div />
      )}
      <div className="flex items-center gap-0.5 rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur">
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-7 w-7"
          disabled={zoom <= zoomMin}
          onClick={zoomOut}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <button
          className="min-w-[3rem] text-center text-xs font-medium tabular-nums"
          onClick={zoomReset}
          title="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-7 w-7"
          disabled={zoom >= zoomMax}
          onClick={zoomIn}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

import { useEffect, useState } from "react"
import { Outlet, useLocation } from "react-router-dom"
import { Button, Surface } from "@heroui/react"
import { Minus, Plus } from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"
import { AppNavbar } from "@/components/layout/app-navbar"
import { SidebarInset, SidebarProvider } from "@/components/layout/sidebar"
import { storeResumeRoute } from "./resume-route"

const ZOOM_LEVEL_KEY = "kasir-zoom-level"
const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.0

function getInitialZoom(): number {
  const stored = localStorage.getItem(ZOOM_LEVEL_KEY)
  if (stored) {
    const value = parseFloat(stored)
    if (!isNaN(value) && value >= ZOOM_MIN && value <= ZOOM_MAX) return value
  }
  return 1.0
}

function stepZoom(zoom: number, step: number): number {
  const next = Math.round((zoom + step) * 10) / 10
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
}

export function AppLayout() {
  const location = useLocation()
  const [zoom, setZoom] = useState(getInitialZoom)

  useEffect(() => {
    document.documentElement.style.zoom = String(zoom)
    localStorage.setItem(ZOOM_LEVEL_KEY, String(zoom))
  }, [zoom])

  useEffect(() => {
    storeResumeRoute(location.pathname)
  }, [location.pathname])

  // Session timeout check — disabled (single-terminal POS, no need for auto-logout)
  // useEffect(() => {
  //   const interval = setInterval(() => {
  //     if (checkTimeout()) {
  //       toast.error(id.auth.sessionExpired)
  //       navigate("/login")
  //     }
  //   }, 5 * 60_000)
  //   return () => clearInterval(interval)
  // }, [checkTimeout, navigate])

  // Zoom shortcuts: Ctrl+/- to step, Ctrl+0 to reset. Ctrl+B belongs to the
  // sidebar and is bound by SidebarProvider.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return

      if (event.key === "=" || event.key === "+") {
        event.preventDefault()
        setZoom((z) => stepZoom(z, ZOOM_STEP))
      } else if (event.key === "-") {
        event.preventDefault()
        setZoom((z) => stepZoom(z, -ZOOM_STEP))
      } else if (event.key === "0") {
        event.preventDefault()
        setZoom(1.0)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  // `document.documentElement.style.zoom` scales the viewport too, so the shell
  // has to be sized in pre-zoom pixels to keep filling the window.
  const shellHeight = `calc(100svh / ${zoom})`

  return (
    <SidebarProvider style={{ height: shellHeight }}>
      <AppSidebar style={{ height: shellHeight }} />
      <SidebarInset>
        <AppNavbar>
          <ZoomToolbar
            zoom={zoom}
            zoomIn={() => setZoom((z) => stepZoom(z, ZOOM_STEP))}
            zoomOut={() => setZoom((z) => stepZoom(z, -ZOOM_STEP))}
            zoomReset={() => setZoom(1.0)}
          />
          {/* `print:overflow-visible`: pembungkus ini yang menggulung isi layar,
              jadi saat mencetak ia juga yang memotong halaman jadi satu viewport.
              Padding samping 24px menyamakan tepi isi dengan tepi judul di navbar. */}
          <div className="flex flex-1 flex-col gap-4 overflow-auto px-6 pt-2 pb-16 lg:pb-6 print:overflow-visible">
            <Outlet />
          </div>
        </AppNavbar>
      </SidebarInset>
    </SidebarProvider>
  )
}

interface ZoomToolbarProps {
  zoom: number
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
}

/**
 * Kontrol zoom untuk layar kecil. Tombol "Buka menu" yang dulu menemaninya
 * sudah tidak ada: tombol lipat di navbar membuka drawer yang sama di ponsel.
 */
function ZoomToolbar({ zoom, zoomIn, zoomOut, zoomReset }: ZoomToolbarProps) {
  return (
    <div className="fixed right-4 bottom-4 z-50 lg:hidden">
      <Surface
        className="flex items-center gap-0.5 rounded-2xl p-1 shadow-surface"
        variant="default"
      >
        <Button
          isIconOnly
          aria-label="Perkecil tampilan"
          isDisabled={zoom <= ZOOM_MIN}
          size="sm"
          variant="tertiary"
          onPress={zoomOut}
        >
          <Minus />
        </Button>
        <Button
          className="min-w-12 text-xs font-medium tabular-nums"
          size="sm"
          variant="tertiary"
          onPress={zoomReset}
        >
          {Math.round(zoom * 100)}%
        </Button>
        <Button
          isIconOnly
          aria-label="Perbesar tampilan"
          isDisabled={zoom >= ZOOM_MAX}
          size="sm"
          variant="tertiary"
          onPress={zoomIn}
        >
          <Plus />
        </Button>
      </Surface>
    </div>
  )
}

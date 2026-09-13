import { useEffect } from "react"
import { Outlet, useLocation } from "react-router-dom"
import { Button, Surface } from "@heroui/react"
import { Minus, Plus } from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"
import { AppNavbar } from "@/components/layout/app-navbar"
import { SidebarInset, SidebarProvider } from "@/components/layout/sidebar"
import { UpdateBanner } from "@/features/updater"
import { storeResumeRoute } from "./resume-route"
import { useWindowIcon } from "./use-window-icon"
import { ZOOM_MAX, ZOOM_MIN, useWindowZoom } from "./use-window-zoom"

export function AppLayout() {
  const location = useLocation()
  const { zoom, available, zoomIn, zoomOut, zoomReset } = useWindowZoom()
  useWindowIcon(available)

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
  // sidebar and is bound by SidebarProvider. Only bound when this client is
  // the till window; a LAN browser keeps its own Ctrl+/- untouched.
  useEffect(() => {
    if (!available) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return

      if (event.key === "=" || event.key === "+") {
        event.preventDefault()
        zoomIn()
      } else if (event.key === "-") {
        event.preventDefault()
        zoomOut()
      } else if (event.key === "0") {
        event.preventDefault()
        zoomReset()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [available, zoomIn, zoomOut, zoomReset])

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppNavbar>
          {available && (
            <ZoomToolbar zoom={zoom} zoomIn={zoomIn} zoomOut={zoomOut} zoomReset={zoomReset} />
          )}
          {/* `print:overflow-visible`: pembungkus ini yang menggulung isi layar,
              jadi saat mencetak ia juga yang memotong halaman jadi satu viewport.
              Padding samping 24px menyamakan tepi isi dengan tepi judul di navbar. */}
          <div className="flex flex-1 flex-col gap-4 overflow-auto px-6 pt-2 pb-16 lg:pb-6 print:overflow-visible">
            <UpdateBanner />
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
      <Surface className="flex items-center gap-0.5 p-1 shadow-surface" variant="default">
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

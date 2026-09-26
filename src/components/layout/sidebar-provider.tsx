import * as React from "react"

import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import {
  SIDEBAR_AUTO_COLLAPSE_WIDTH,
  SIDEBAR_OPEN_STORAGE_KEY,
  SidebarContext,
  type SidebarContextValue,
} from "./sidebar-context"

/**
 * Application sidebar.
 *
 * HeroUI v3 has no sidebar, so this is built from HeroUI primitives (Drawer for
 * the mobile sheet, Tooltip for the collapsed labels) plus Tailwind. It keeps the
 * behaviour the cashier screen relies on:
 *
 *   - collapse to an icon rail, remembered in `localStorage`
 *   - auto-collapse below 1280px without overwriting what the user chose
 *   - Ctrl/Cmd+B from anywhere, including while the barcode field has focus
 *   - hover to peek at the labels, click the header button to pin them open
 *
 * Only an explicit action writes to `localStorage`. Peeking at the rail with the
 * pointer must not turn into a stored preference.
 */

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY) !== "false"
  } catch {
    return true
  }
}

function persistOpen(open: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(open))
  } catch {
    // Storage can be unavailable in a locked-down webview; the sidebar still works.
  }
}

function isNarrowWindow(): boolean {
  return window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH
}

function getInitialOpen(): boolean {
  return isNarrowWindow() ? false : readStoredOpen()
}

interface SidebarProviderProps {
  children: React.ReactNode
  className?: string
}

export function SidebarProvider({ children, className }: SidebarProviderProps) {
  const isMobile = useIsMobile()
  const [open, setOpenState] = React.useState(getInitialOpen)
  const [openMobile, setOpenMobile] = React.useState(false)
  const [hoverExpanded, setHoverExpanded] = React.useState(false)
  // Tracks a collapse the window size forced on us, so widening the window can
  // restore the stored preference instead of leaving the sidebar shut.
  const [autoCollapsed, setAutoCollapsed] = React.useState(isNarrowWindow)

  const setOpen = React.useCallback((value: boolean) => {
    setHoverExpanded(false)
    setAutoCollapsed(false)
    setOpenState(value)
    persistOpen(value)
  }, [])

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((previous) => !previous)
      return
    }
    setOpen(!open)
  }, [isMobile, open, setOpen])

  const beginHoverExpand = React.useCallback(() => {
    setHoverExpanded(true)
    setOpenState(true)
  }, [])

  const endHoverExpand = React.useCallback(() => {
    setHoverExpanded(false)
    setOpenState(false)
  }, [])

  const pinSidebar = React.useCallback(() => {
    setOpen(true)
  }, [setOpen])

  // Read by the resize handler below, which must not re-subscribe whenever the
  // sidebar opens — otherwise a hover expansion on a narrow window would trip the
  // auto-collapse and snap straight back.
  const latest = React.useRef({ open, autoCollapsed })
  React.useEffect(() => {
    latest.current = { open, autoCollapsed }
  }, [open, autoCollapsed])

  React.useEffect(() => {
    const query = window.matchMedia(`(max-width: ${SIDEBAR_AUTO_COLLAPSE_WIDTH - 1}px)`)

    const handleChange = () => {
      if (query.matches) {
        if (!latest.current.open) return
        setHoverExpanded(false)
        setOpenState(false)
        setAutoCollapsed(true)
      } else if (latest.current.autoCollapsed) {
        setOpenState(readStoredOpen())
        setAutoCollapsed(false)
      }
    }

    handleChange()
    query.addEventListener("change", handleChange)
    return () => query.removeEventListener("change", handleChange)
  }, [])

  // Ctrl/Cmd+B is bound on the window so it also fires while the cashier screen
  // holds focus in the barcode field.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() !== "b") return
      event.preventDefault()
      toggleSidebar()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  const value = React.useMemo<SidebarContextValue>(
    () => ({
      state: open ? "expanded" : "collapsed",
      open,
      setOpen,
      toggleSidebar,
      isMobile,
      openMobile,
      setOpenMobile,
      hoverExpanded,
      beginHoverExpand,
      endHoverExpand,
      pinSidebar,
    }),
    [
      open,
      setOpen,
      toggleSidebar,
      isMobile,
      openMobile,
      hoverExpanded,
      beginHoverExpand,
      endHoverExpand,
      pinSidebar,
    ],
  )

  return (
    <SidebarContext.Provider value={value}>
      <div
        data-slot="sidebar-wrapper"
        className={cn("flex h-svh w-full overflow-hidden bg-background", className)}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

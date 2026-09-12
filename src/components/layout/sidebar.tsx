import * as React from "react"
import { NavLink } from "react-router-dom"
import { Drawer, Tooltip } from "@heroui/react"

import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import {
  SIDEBAR_AUTO_COLLAPSE_WIDTH,
  SIDEBAR_HOVER_EXPAND_DELAY_MS,
  SIDEBAR_OPEN_STORAGE_KEY,
  SidebarContext,
  sidebarMenuButtonClass,
  sidebarSubMenuButtonClass,
  useSidebar,
  type SidebarContextValue,
  type SidebarMenuSize,
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
  style?: React.CSSProperties
}

export function SidebarProvider({ children, className, style }: SidebarProviderProps) {
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
        className={cn("flex w-full overflow-hidden bg-background", className)}
        style={style}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

interface SidebarProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  /** Accessible name of the navigation landmark. */
  label: string
}

export function Sidebar({ children, className, style, label }: SidebarProps) {
  const {
    state,
    open,
    isMobile,
    openMobile,
    setOpenMobile,
    hoverExpanded,
    beginHoverExpand,
    endHoverExpand,
  } = useSidebar()
  const hoverTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    },
    [],
  )

  if (isMobile) {
    return (
      <Drawer.Backdrop isOpen={openMobile} onOpenChange={setOpenMobile}>
        <Drawer.Content placement="left">
          <Drawer.Dialog aria-label={label} className="bg-background p-2">
            <nav
              aria-label={label}
              data-slot="sidebar"
              data-state="expanded"
              className="group/sidebar flex h-full w-full min-w-0 flex-col"
            >
              {children}
            </nav>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    )
  }

  return (
    <nav
      aria-label={label}
      data-slot="sidebar"
      data-state={state}
      className={cn(
        "group/sidebar hidden shrink-0 flex-col border-r border-border transition-[width] duration-200 ease-linear md:flex",
        open ? "w-60" : "w-15",
        className,
      )}
      style={style}
      onMouseEnter={() => {
        if (open) return
        hoverTimeout.current = setTimeout(beginHoverExpand, SIDEBAR_HOVER_EXPAND_DELAY_MS)
      }}
      onMouseLeave={() => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
        if (hoverExpanded) endHoverExpand()
      }}
    >
      <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">{children}</div>
    </nav>
  )
}

/**
 * Area isi halaman. Namanya masih "Inset" dari shadcn, tapi panel bertepi
 * bulat dan berbayang yang dulu menyertainya sudah dilepas: sidebar dan isi
 * duduk di kanvas `--background` yang sama, dipisah satu garis tepi, dan kartu
 * `--surface` di dalamnya yang menonjol — persis susunan template dashboard
 * HeroUI. Panel putih di atas kanvas abu-abu membuat kartu putih di dalamnya
 * kehilangan tepinya.
 */
export function SidebarInset({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn("relative flex min-w-0 flex-1 flex-col overflow-hidden", className)}
    >
      {children}
    </main>
  )
}

export function SidebarHeader({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn(
        "relative flex flex-col gap-2 px-4 pt-4 pb-2 group-data-[state=collapsed]/sidebar:px-3",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function SidebarContent({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn(
        "scrollbar-none flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto px-3",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function SidebarFooter({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div data-slot="sidebar-footer" className={cn("flex flex-col gap-1 px-3 pt-2 pb-4", className)}>
      {children}
    </div>
  )
}

export function SidebarGroup({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn("relative flex w-full min-w-0 flex-col gap-1", className)}
    >
      {children}
    </div>
  )
}

export function SidebarMenu({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <ul data-slot="sidebar-menu" className={cn("flex w-full min-w-0 flex-col gap-1", className)}>
      {children}
    </ul>
  )
}

export function SidebarMenuItem({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <li data-slot="sidebar-menu-item" className={cn("group/menu-item relative", className)}>
      {children}
    </li>
  )
}

/** Text that disappears when the rail collapses. */
export function SidebarLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      data-slot="sidebar-label"
      className={cn(
        "min-w-0 flex-1 text-left group-data-[state=collapsed]/sidebar:hidden",
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * Wraps a collapsed row in a tooltip so the label is still reachable.
 * Expanded, the label is already on screen and the tooltip only gets in the way.
 */
function useCollapsedTooltip(tooltip: string | undefined): boolean {
  const { state, isMobile } = useSidebar()
  return Boolean(tooltip) && state === "collapsed" && !isMobile
}

type SidebarMenuLinkProps = Omit<React.ComponentProps<typeof NavLink>, "className" | "children"> & {
  isActive?: boolean
  size?: SidebarMenuSize
  tooltip?: string
  className?: string
  children: React.ReactNode
}

export function SidebarMenuLink({
  isActive = false,
  size = "default",
  tooltip,
  className,
  children,
  ...props
}: SidebarMenuLinkProps) {
  const showTooltip = useCollapsedTooltip(tooltip)
  const classes = sidebarMenuButtonClass(size, className)

  if (!showTooltip) {
    return (
      <NavLink data-slot="sidebar-menu-link" data-active={isActive} className={classes} {...props}>
        {children}
      </NavLink>
    )
  }

  // `render` puts React Aria's hover and focus handlers straight onto the anchor,
  // the way Radix `asChild` used to. Without it Tooltip.Trigger would wrap the
  // link in a `role="button"` div and add a second tab stop.
  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger<"a">
        render={({ role: _role, className: triggerClassName, ...domProps }) => (
          <NavLink
            data-slot="sidebar-menu-link"
            data-active={isActive}
            {...props}
            {...domProps}
            className={cn(classes, triggerClassName)}
          >
            {children}
          </NavLink>
        )}
      />
      <Tooltip.Content placement="right">{tooltip}</Tooltip.Content>
    </Tooltip>
  )
}

export function SidebarSubMenu({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <ul
      data-slot="sidebar-sub-menu"
      className={cn(
        "mx-3.5 flex min-w-0 flex-col gap-1 border-l border-border px-2.5 py-0.5",
        "group-data-[state=collapsed]/sidebar:hidden",
        className,
      )}
    >
      {children}
    </ul>
  )
}

type SidebarSubMenuLinkProps = Omit<
  React.ComponentProps<typeof NavLink>,
  "className" | "children"
> & {
  isActive?: boolean
  className?: string
  children: React.ReactNode
}

export function SidebarSubMenuLink({
  isActive = false,
  className,
  children,
  ...props
}: SidebarSubMenuLinkProps) {
  return (
    <NavLink
      data-slot="sidebar-sub-menu-link"
      data-active={isActive}
      className={sidebarSubMenuButtonClass(className)}
      {...props}
    >
      {children}
    </NavLink>
  )
}

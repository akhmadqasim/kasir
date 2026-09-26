import * as React from "react"
import { NavLink, useLocation } from "react-router-dom"
import { Drawer, Tooltip } from "@heroui/react"

import { cn } from "@/lib/utils"
import {
  SIDEBAR_HOVER_EXPAND_DELAY_MS,
  sidebarMenuButtonClass,
  sidebarSubMenuButtonClass,
  useSidebar,
  type SidebarMenuSize,
} from "./sidebar-context"

/**
 * The sidebar's building blocks: the `<nav>` itself (a Drawer on mobile, a
 * collapsible rail elsewhere) and the rows inside it. Their state comes from
 * `SidebarProvider` in `sidebar-provider.tsx`.
 */

/** The shape every layout slot below takes. */
interface SlotProps {
  children: React.ReactNode
  className?: string
}

interface SidebarProps extends SlotProps {
  /** Accessible name of the navigation landmark. */
  label: string
}

export function Sidebar({ children, className, label }: SidebarProps) {
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
  const { pathname } = useLocation()

  React.useEffect(
    () => () => {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    },
    [],
  )

  // The mobile drawer is modal: once a link has navigated, it would keep
  // covering the page it just opened.
  React.useEffect(() => {
    setOpenMobile(false)
  }, [pathname, setOpenMobile])

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
export function SidebarInset({ children, className }: SlotProps) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn("relative flex min-w-0 flex-1 flex-col overflow-hidden", className)}
    >
      {children}
    </main>
  )
}

export function SidebarHeader({ children, className }: SlotProps) {
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

export function SidebarContent({ children, className }: SlotProps) {
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

export function SidebarFooter({ children, className }: SlotProps) {
  return (
    <div data-slot="sidebar-footer" className={cn("flex flex-col gap-1 px-3 pt-2 pb-4", className)}>
      {children}
    </div>
  )
}

export function SidebarGroup({ children, className }: SlotProps) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn("relative flex w-full min-w-0 flex-col gap-1", className)}
    >
      {children}
    </div>
  )
}

export function SidebarMenu({ children, className }: SlotProps) {
  return (
    <ul data-slot="sidebar-menu" className={cn("flex w-full min-w-0 flex-col gap-1", className)}>
      {children}
    </ul>
  )
}

export function SidebarMenuItem({ children, className }: SlotProps) {
  return (
    <li data-slot="sidebar-menu-item" className={cn("group/menu-item relative", className)}>
      {children}
    </li>
  )
}

/**
 * Text that disappears when the rail collapses.
 *
 * Collapsed, it is `sr-only`, not `hidden`: `display: none` also drops the text
 * from the accessibility tree, and the rail's links and the "Laporan" trigger
 * were left as icon-only controls with no name at all — the tooltip only
 * describes, it does not label.
 */
export function SidebarLabel({ children, className }: SlotProps) {
  return (
    <span
      data-slot="sidebar-label"
      className={cn(
        "min-w-0 flex-1 text-left group-data-[state=collapsed]/sidebar:sr-only",
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

export function SidebarSubMenu({ children, className }: SlotProps) {
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

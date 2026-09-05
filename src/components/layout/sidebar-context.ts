import { createContext, useContext } from "react"

import { cn } from "@/lib/utils"

/**
 * Non-component half of the sidebar.
 *
 * The context, the hook and the class builders live here rather than in
 * `sidebar.tsx` so that file only ever exports components and Fast Refresh keeps
 * working for it.
 */

/** Where the collapse state survives a reload. Read on first paint, so keep it cheap. */
export const SIDEBAR_OPEN_STORAGE_KEY = "kasir-sidebar-open"

/** Below this window width the sidebar collapses itself and stays out of the way. */
export const SIDEBAR_AUTO_COLLAPSE_WIDTH = 1280

/** How long the pointer has to rest on the collapsed rail before it expands. */
export const SIDEBAR_HOVER_EXPAND_DELAY_MS = 200

export type SidebarState = "expanded" | "collapsed"

export type SidebarMenuSize = "sm" | "default" | "lg"

export interface SidebarContextValue {
  /** `expanded` while the labels are visible, whether pinned or expanded by hover. */
  state: SidebarState
  open: boolean
  /** Explicit open/close from the user. Persists, and cancels a hover expansion. */
  setOpen: (open: boolean) => void
  /** Opens the drawer on mobile, toggles the rail everywhere else. */
  toggleSidebar: () => void
  isMobile: boolean
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  /** True while the sidebar is only open because the pointer is resting on it. */
  hoverExpanded: boolean
  /** Expand without persisting — the sidebar snaps back when the pointer leaves. */
  beginHoverExpand: () => void
  endHoverExpand: () => void
  /** Turn a hover expansion into a real one. */
  pinSidebar: () => void
}

export const SidebarContext = createContext<SidebarContextValue | null>(null)

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a <SidebarProvider>.")
  }
  return context
}

/**
 * Shared look of every clickable row in the sidebar.
 *
 * The collapsed rail is driven by `data-state` on the sidebar root (group
 * `sidebar`) instead of a prop, so a row does not need to re-render to shrink.
 */
const MENU_BUTTON_BASE = [
  "group/menu-button relative flex w-full items-center gap-2 overflow-hidden rounded-md p-2",
  "text-left text-sidebar-foreground transition-colors outline-hidden",
  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
  "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
  "data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
  "[&_svg]:size-4 [&_svg]:shrink-0",
  "group-data-[state=collapsed]/sidebar:w-8 group-data-[state=collapsed]/sidebar:justify-center group-data-[state=collapsed]/sidebar:p-0",
].join(" ")

const MENU_BUTTON_SIZE: Record<SidebarMenuSize, string> = {
  sm: "h-7 text-xs",
  default: "h-8 text-sm",
  lg: "h-12 text-sm",
}

export function sidebarMenuButtonClass(
  size: SidebarMenuSize = "default",
  className?: string
): string {
  return cn(MENU_BUTTON_BASE, MENU_BUTTON_SIZE[size], className)
}

/** Rows of a nested menu: indented, and gone entirely once the rail collapses. */
export function sidebarSubMenuButtonClass(className?: string): string {
  return cn(
    "flex h-7 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-xs",
    "text-sidebar-foreground transition-colors outline-hidden",
    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
    className
  )
}

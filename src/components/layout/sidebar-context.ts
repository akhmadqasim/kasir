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
 * Meniru baris HeroUI yang sesungguhnya — `.list-box-item` dan `.menu-item`:
 * `rounded-2xl`, `gap-3`, hover `bg-default`, fokus `status-focused`, dan
 * mengecil sedikit saat ditekan. Sebelumnya baris ini memakai bahasa shadcn
 * (`rounded-md`, `gap-2`, `ring-sidebar-ring`), dan itulah yang membuat menu
 * aktif terlihat berasal dari sistem lain daripada isi halamannya.
 *
 * Ukurannya diambil dari computed style template dashboard HeroUI Pro, bukan
 * dikira-kira: baris 36px, `padding: 6px 8px`, `gap: 12px`, sudut 16px, ikon
 * 20px, label `text-sm font-medium` untuk semua item, dan yang aktif memakai
 * `--default` — bukan `--surface`, yang di kanvas yang sama akan terlihat
 * seperti kartu tersesat di navigasi. Hover memakai warna yang sama dengan
 * aktif, seperti `.list-box-item` HeroUI.
 *
 * The collapsed rail is driven by `data-state` on the sidebar root (group
 * `sidebar`) instead of a prop, so a row does not need to re-render to shrink.
 */
const MENU_BUTTON_BASE = [
  "group/menu-button relative flex w-full items-center gap-3 overflow-hidden rounded-2xl px-2 py-1.5",
  "text-left text-sm font-medium text-foreground outline-none no-highlight",
  "transition-[background-color,box-shadow] duration-150 motion-reduce:transition-none",
  "hover:bg-default",
  "focus-visible:status-focused",
  "active:scale-[0.98]",
  "data-[active=true]:bg-default",
  "disabled:status-disabled aria-disabled:status-disabled",
  "[&_svg]:size-5 [&_svg]:shrink-0",
  "group-data-[state=collapsed]/sidebar:w-9 group-data-[state=collapsed]/sidebar:justify-center group-data-[state=collapsed]/sidebar:px-0",
].join(" ")

const MENU_BUTTON_SIZE: Record<SidebarMenuSize, string> = {
  sm: "min-h-8 text-xs",
  default: "min-h-9",
  lg: "min-h-12",
}

export function sidebarMenuButtonClass(
  size: SidebarMenuSize = "default",
  className?: string,
): string {
  return cn(MENU_BUTTON_BASE, MENU_BUTTON_SIZE[size], className)
}

/** Rows of a nested menu: indented, and gone entirely once the rail collapses. */
export function sidebarSubMenuButtonClass(className?: string): string {
  return cn(
    "flex min-h-8 w-full min-w-0 items-center gap-2 overflow-hidden rounded-xl px-2 text-xs",
    "text-muted outline-none no-highlight",
    "transition-[background-color,color] duration-150 motion-reduce:transition-none",
    "hover:bg-default hover:text-foreground",
    "focus-visible:status-focused",
    "data-[active=true]:bg-default data-[active=true]:font-medium data-[active=true]:text-foreground",
    className,
  )
}

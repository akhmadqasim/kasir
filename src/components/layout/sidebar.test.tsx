import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuLink,
  SidebarProvider,
} from "./sidebar"
import {
  SIDEBAR_HOVER_EXPAND_DELAY_MS,
  SIDEBAR_OPEN_STORAGE_KEY,
  useSidebar,
} from "./sidebar-context"

const WIDE = 1440
const NARROW = 1024

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  })
}

function resizeTo(width: number) {
  act(() => {
    setWindowWidth(width)
    fireEvent(window, new Event("resize"))
  })
}

/** Exposes the pin action, which only the sidebar header reaches in the real app. */
function PinButton() {
  const { pinSidebar } = useSidebar()
  return (
    <button type="button" onClick={pinSidebar}>
      Sematkan
    </button>
  )
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/cashier"]}>
      <SidebarProvider>
        <Sidebar label="Menu utama">
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuLink to="/cashier" tooltip="Kasir" isActive>
                  <SidebarLabel>Kasir</SidebarLabel>
                </SidebarMenuLink>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
          <PinButton />
        </Sidebar>
        <SidebarInset>Konten</SidebarInset>
      </SidebarProvider>
    </MemoryRouter>
  )
}

function sidebar() {
  return screen.getByRole("navigation", { name: "Menu utama" })
}

/**
 * The shell is the one piece of UI the cashier never chooses to interact with, so
 * every one of these behaviours has to survive on its own: what is stored, what the
 * window size forces, and what the keyboard does.
 */
describe("sidebar shell", () => {
  beforeEach(() => {
    localStorage.clear()
    setWindowWidth(WIDE)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts expanded on a wide window when nothing was stored", () => {
    renderShell()

    expect(sidebar()).toHaveAttribute("data-state", "expanded")
  })

  it("restores a collapsed sidebar from localStorage", () => {
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false")

    renderShell()

    expect(sidebar()).toHaveAttribute("data-state", "collapsed")
  })

  it("collapses below 1280px without overwriting the stored preference", () => {
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "true")
    setWindowWidth(NARROW)

    renderShell()

    expect(sidebar()).toHaveAttribute("data-state", "collapsed")
    expect(localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("true")
  })

  it("restores the stored state once the window is wide again", () => {
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "true")

    renderShell()
    resizeTo(NARROW)
    expect(sidebar()).toHaveAttribute("data-state", "collapsed")

    resizeTo(WIDE)
    expect(sidebar()).toHaveAttribute("data-state", "expanded")
  })

  it("toggles with Ctrl+B and stores the result", () => {
    renderShell()

    act(() => {
      fireEvent.keyDown(window, { key: "b", ctrlKey: true })
    })

    expect(sidebar()).toHaveAttribute("data-state", "collapsed")
    expect(localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("false")

    act(() => {
      fireEvent.keyDown(window, { key: "b", ctrlKey: true })
    })

    expect(sidebar()).toHaveAttribute("data-state", "expanded")
    expect(localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("true")
  })

  it("leaves Ctrl+B alone when no modifier is held, so typing a barcode is safe", () => {
    renderShell()

    act(() => {
      fireEvent.keyDown(window, { key: "b" })
    })

    expect(sidebar()).toHaveAttribute("data-state", "expanded")
  })

  it("expands on hover after a delay and snaps back without storing anything", () => {
    vi.useFakeTimers()
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false")

    renderShell()
    const nav = sidebar()

    fireEvent.mouseEnter(nav)
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_HOVER_EXPAND_DELAY_MS)
    })
    expect(nav).toHaveAttribute("data-state", "expanded")
    expect(localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("false")

    fireEvent.mouseLeave(nav)
    expect(nav).toHaveAttribute("data-state", "collapsed")
    expect(localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("false")
  })

  it("keeps the sidebar open once a hover expansion is pinned", () => {
    vi.useFakeTimers()
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false")

    renderShell()
    const nav = sidebar()

    fireEvent.mouseEnter(nav)
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_HOVER_EXPAND_DELAY_MS)
    })
    fireEvent.click(screen.getByRole("button", { name: "Sematkan" }))
    fireEvent.mouseLeave(nav)

    expect(nav).toHaveAttribute("data-state", "expanded")
    expect(localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("true")
  })

  it("renders menu items as links regardless of the collapse state", () => {
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false")

    renderShell()

    const link = screen.getByRole("link", { name: "Kasir" })
    expect(link).toHaveAttribute("href", "/cashier")
    expect(link).toHaveAttribute("data-active", "true")
  })
})

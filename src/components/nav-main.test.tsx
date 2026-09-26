import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, useNavigate } from "react-router-dom"
import { Building2Icon, ShoppingCartIcon } from "lucide-react"

import { NavMain } from "./nav-main"
import { Sidebar } from "@/components/layout/sidebar"
import { SidebarProvider } from "@/components/layout/sidebar-provider"
import { SIDEBAR_OPEN_STORAGE_KEY } from "@/components/layout/sidebar-context"

const items = [
  { title: "Kasir", url: "/cashier", icon: <ShoppingCartIcon /> },
  { title: "PPOB", url: "/ppob", icon: <Building2Icon /> },
  {
    title: "Laporan",
    url: "/reports",
    icon: <ShoppingCartIcon />,
    items: [
      { group: "Penjualan", title: "Per Hari", url: "/reports/sales-daily" },
      { group: "Penjualan", title: "Per Bulan", url: "/reports/sales-monthly" },
    ],
  },
]

function renderNav(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <SidebarProvider>
        <Sidebar label="Menu utama">
          <NavMain items={items} />
        </Sidebar>
      </SidebarProvider>
    </MemoryRouter>,
  )
}

/**
 * The highlight tells the cashier where they are. A nested screen such as the PPOB
 * history is still the PPOB menu entry, so an exact path comparison is wrong.
 */
describe("nav-main active state", () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1440,
    })
  })

  it("highlights the menu entry a nested route belongs to", () => {
    renderNav("/ppob/history")

    expect(screen.getByRole("link", { name: "PPOB" })).toHaveAttribute("data-active", "true")
    expect(screen.getByRole("link", { name: "Kasir" })).toHaveAttribute("data-active", "false")
  })

  it("still highlights an exact match", () => {
    renderNav("/cashier")

    expect(screen.getByRole("link", { name: "Kasir" })).toHaveAttribute("data-active", "true")
    expect(screen.getByRole("link", { name: "PPOB" })).toHaveAttribute("data-active", "false")
  })

  it("opens the sub-menu of the section the route sits in and marks only the leaf", () => {
    renderNav("/reports/sales-daily")

    expect(screen.getByRole("link", { name: "Per Hari" })).toHaveAttribute("data-active", "true")
    expect(screen.getByRole("link", { name: "Per Bulan" })).toHaveAttribute("data-active", "false")
  })

  it("keeps an unrelated section collapsed", () => {
    renderNav("/cashier")

    expect(screen.queryByRole("link", { name: "Per Hari" })).not.toBeInTheDocument()
  })
})

/** Navigates from outside the menu, the way a dashboard link or a redirect does. */
function GoTo({ to }: { to: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(to)}>
      Pergi
    </button>
  )
}

describe("nav-main group on the collapsed rail", () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1440,
    })
  })

  it("marks the section trigger active and pins the sidebar open when pressed", () => {
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false")
    renderNav("/reports/sales-daily")

    const trigger = screen.getByRole("button", { name: "Laporan" })
    expect(trigger).toHaveAttribute("data-active", "true")

    fireEvent.click(trigger)

    expect(screen.getByRole("navigation", { name: "Menu utama" })).toHaveAttribute(
      "data-state",
      "expanded",
    )
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("link", { name: "Per Hari" })).toBeInTheDocument()
  })

  it("opens the section when navigation lands inside it from elsewhere", () => {
    render(
      <MemoryRouter initialEntries={["/cashier"]}>
        <SidebarProvider>
          <Sidebar label="Menu utama">
            <NavMain items={items} />
          </Sidebar>
          <GoTo to="/reports/sales-monthly" />
        </SidebarProvider>
      </MemoryRouter>,
    )
    expect(screen.queryByRole("link", { name: "Per Bulan" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Pergi" }))

    expect(screen.getByRole("link", { name: "Per Bulan" })).toHaveAttribute("data-active", "true")
  })
})

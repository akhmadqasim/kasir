import { beforeEach, describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { Building2Icon, ShoppingCartIcon } from "lucide-react"

import { NavMain } from "./nav-main"
import { Sidebar, SidebarProvider } from "@/components/layout/sidebar"

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

import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { NavUser } from "./nav-user"
import { SidebarProvider } from "@/components/layout/sidebar-provider"
import { useAuthStore } from "@/features/auth"
import type { User } from "@/features/auth/types"
import { useShiftStore } from "@/features/shift"
import { useCartStore } from "@/stores/cart-store"
import { installApiMock, type ApiMock } from "@/test-utils/api-mock"

const KASIR: User = {
  id: 2,
  username: "kasir01",
  full_name: "Kasir Satu",
  role: "kasir",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

let api: ApiMock

function renderNavUser() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/cashier"]}>
        <SidebarProvider>
          <Routes>
            <Route element={<NavUser />} path="/cashier" />
            <Route element={<p>Halaman login</p>} path="/login" />
          </Routes>
        </SidebarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api = installApiMock({ "POST /auth/logout": null })
  useAuthStore.setState({ user: KASIR })
  useShiftStore.setState({
    activeShift: {
      id: 9,
      userId: 2,
      userName: "Kasir Satu",
      openingCash: 0,
      closingCash: null,
      openedAt: "2026-09-05 01:00:00",
      closedAt: null,
      notes: null,
      status: "open",
    },
  })
  useCartStore.setState({
    items: [
      {
        cart_id: "line-1",
        product_id: 1,
        product_name: "Indomie Goreng",
        product_price: 3000,
        quantity: 2,
        stock: 50,
        unit: "pcs",
      },
    ],
  })
})

describe("menu pengguna di sidebar", () => {
  it("menyebut peran dengan label bersama", () => {
    renderNavUser()

    expect(screen.getByText("Kasir")).toBeInTheDocument()
  })

  // The shift and cart used to be cleared here as well as in `useLogout`;
  // the hook alone must still leave nothing for the next cashier.
  it("keluar lewat useLogout: shift dan keranjang kosong, lalu ke halaman login", async () => {
    renderNavUser()

    fireEvent.click(screen.getByRole("button", { name: /Profil Saya/ }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Keluar" }))

    expect(await screen.findByText("Halaman login")).toBeInTheDocument()
    expect(api.callsFor("POST /auth/logout")).toHaveLength(1)
    await waitFor(() => expect(useCartStore.getState().items).toHaveLength(0))
    expect(useShiftStore.getState().activeShift).toBeNull()
    expect(useAuthStore.getState().user).toBeNull()
  })
})

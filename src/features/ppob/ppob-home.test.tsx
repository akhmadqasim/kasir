import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { installApiMock } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { User } from "@/features/auth/types"
import { PLN_ROW } from "./history-fixture"
import { PpobHome } from "./components/ppob-home"

const ADMIN: User = {
  id: 1,
  username: "admin",
  full_name: "Admin Toko",
  role: "admin",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/ppob"]}>
        <TestNavbar>
          <Routes>
            <Route path="/ppob" element={<PpobHome />} />
            <Route path="/ppob/settings" element={<p>halaman pengaturan</p>} />
            <Route path="/ppob/pulsa" element={<p>halaman pulsa</p>} />
          </Routes>
        </TestNavbar>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  installApiMock({
    "GET /ppob/balance": { saldo: 1_500_000, username: "toko" },
    "GET /ppob/history": [PLN_ROW],
  })
  useAuthStore.setState({ user: ADMIN })
})

/** Beranda PPOB: menu layanan dan riwayat berdampingan, bukan sub-halaman terpisah. */
describe("ppob home", () => {
  it("shows the service menu and the history table on one screen", async () => {
    renderHome()

    expect(screen.getByRole("button", { name: "Pulsa" })).toBeInTheDocument()
    expect(await screen.findByRole("grid", { name: "Riwayat transaksi PPOB" })).toBeInTheDocument()
    expect(screen.getByRole("row", { name: /PLN/ })).toBeInTheDocument()

    // History is on the page; the navbar no longer needs a way to it.
    expect(screen.queryByRole("button", { name: "Riwayat" })).toBeNull()
    expect(screen.getByRole("button", { name: "Mutasi" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Notifikasi" })).toBeInTheDocument()
  })

  it("opens a service flow from its tile", () => {
    renderHome()

    fireEvent.click(screen.getByRole("button", { name: "Pulsa" }))
    expect(screen.getByText("halaman pulsa")).toBeInTheDocument()
  })

  it("offers the settings shortcut to an admin only", () => {
    const { unmount } = renderHome()

    fireEvent.click(screen.getByRole("button", { name: "Pengaturan" }))
    expect(screen.getByText("halaman pengaturan")).toBeInTheDocument()
    unmount()

    useAuthStore.setState({ user: { ...ADMIN, role: "kasir" } })
    renderHome()
    expect(screen.queryByRole("button", { name: "Pengaturan" })).toBeNull()
  })
})

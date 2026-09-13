import { beforeEach, describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { installApiMock } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { User } from "@/features/auth/types"
import { PLN_ROW } from "./history-fixture"
import { PpobPage } from "./components/ppob-page"

const KASIR: User = {
  id: 2,
  username: "kasir",
  full_name: "Kasir Toko",
  role: "kasir",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <TestNavbar>
          <Routes>
            <Route path="/ppob/*" element={<PpobPage />} />
            <Route path="/cashier" element={<p>halaman kasir</p>} />
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
  useAuthStore.setState({ user: KASIR })
})

describe("ppob routes", () => {
  /** Rute resume dari versi lama masih boleh menunjuk ke `/ppob/history`. */
  it("sends the old history sub-route back to the home", async () => {
    renderAt("/ppob/history")

    expect(await screen.findByRole("grid", { name: "Riwayat transaksi PPOB" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Pulsa" })).toBeInTheDocument()
  })

  it("keeps a kasir out of the Mitra settings", () => {
    renderAt("/ppob/settings")

    expect(screen.getByText("halaman kasir")).toBeInTheDocument()
  })
})

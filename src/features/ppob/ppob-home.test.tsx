import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"

import { apiFailure, installApiMock } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { User } from "@/features/auth/types"
import { setUnauthorizedHandler } from "@/lib/api/client"
import { id } from "@/i18n/id"
import { PLN_ROW } from "./history-fixture"
import { PpobHome } from "./components/ppob-home"

/** Shows `location.state` so a test can assert exactly what navigating to it carried. */
function LocationStateProbe() {
  const location = useLocation()
  return <p>preselect: {JSON.stringify(location.state)}</p>
}

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
            <Route path="/ppob/pp" element={<LocationStateProbe />} />
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
    expect(screen.getByRole("button", { name: "Informasi" })).toBeInTheDocument()
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

/** "kalau mau bayar Indihome, MyRepublic dan lainnya" — cari dari beranda, bukan lewat Payment Point dulu. */
describe("ppob home search", () => {
  it("shows matching billers and fixed services for a query", async () => {
    installApiMock({
      "GET /ppob/balance": { saldo: 1_500_000, username: "toko" },
      "GET /ppob/history": [PLN_ROW],
      "GET /ppob/catalog/payment-points/search": [
        {
          id: 354,
          plu: "121900061",
          merchant: "Indihome",
          description: "Telkom Indihome",
          label: "Kode Pembayaran",
          inputAmt: 1,
          isTrouble: 0,
          pathIcon: null,
          group: { id: 33, name: "Internet & TV" },
        },
      ],
    })
    renderHome()

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "indihome" },
    })

    expect(await screen.findByRole("button", { name: /Indihome/ })).toBeInTheDocument()
    expect(screen.getByText("Internet & TV")).toBeInTheDocument()
    // The default service tiles are gone once there is a query — this is the
    // results kisi, not the usual one.
    expect(screen.queryByRole("button", { name: "PLN" })).toBeNull()
  })

  /**
   * The debounce (300ms) delays the request itself, not just its answer —
   * TanStack Query reports `isLoading: false` for a query still disabled by
   * an unsettled debounce. Asserting immediately after the keystroke, before
   * any timer has run, catches a regression back to reading that as
   * "confirmed no results" rather than "no answer yet".
   */
  it("does not show the empty state while the search is still debouncing", () => {
    installApiMock({
      "GET /ppob/balance": { saldo: 1_500_000, username: "toko" },
      "GET /ppob/history": [PLN_ROW],
      "GET /ppob/catalog/payment-points/search": [],
    })
    renderHome()

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "indihome" } })

    expect(screen.queryByText(/Tidak ada layanan/)).toBeNull()
  })

  it("shows a matching fixed service tile alongside biller results", async () => {
    installApiMock({
      "GET /ppob/balance": { saldo: 1_500_000, username: "toko" },
      "GET /ppob/history": [PLN_ROW],
      "GET /ppob/catalog/payment-points/search": [],
    })
    renderHome()

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "pulsa" },
    })

    expect(await screen.findByRole("button", { name: "Pulsa" })).toBeInTheDocument()
  })

  it("shows the empty state when nothing matches", async () => {
    installApiMock({
      "GET /ppob/balance": { saldo: 1_500_000, username: "toko" },
      "GET /ppob/history": [PLN_ROW],
      "GET /ppob/catalog/payment-points/search": [],
    })
    renderHome()

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzz-tidak-ada" },
    })

    expect(await screen.findByText('Tidak ada layanan untuk "zzz-tidak-ada"')).toBeInTheDocument()
  })

  it("opens the payment-point flow with the biller preselected", async () => {
    installApiMock({
      "GET /ppob/balance": { saldo: 1_500_000, username: "toko" },
      "GET /ppob/history": [PLN_ROW],
      "GET /ppob/catalog/payment-points/search": [
        {
          id: 354,
          plu: "121900061",
          merchant: "Indihome",
          description: "Telkom Indihome",
          label: "Kode Pembayaran",
          inputAmt: 1,
          isTrouble: 0,
          pathIcon: null,
          group: { id: 33, name: "Internet & TV" },
        },
      ],
    })
    renderHome()

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "indihome" },
    })
    fireEvent.click(await screen.findByRole("button", { name: /Indihome/ }))

    expect(
      await screen.findByText(
        'preselect: {"preselectGroup":{"id":33,"name":"Internet & TV"},"preselectItemId":354}',
      ),
    ).toBeInTheDocument()
  })
})

/**
 * The bug this guards against: opening this page used to log the cashier out
 * of the whole app whenever the *upstream* Mitra account had an auth problem
 * (wrong/expired credentials, an expired Mitra session) — a 401 the frontend's
 * global handler cannot tell apart from its own session dying. The backend now
 * answers those with 502 `"upstream"` instead, which must reach this page as
 * an inline error, not as a forced logout.
 */
describe("ppob home when the Mitra upstream itself is failing", () => {
  afterEach(() => {
    setUnauthorizedHandler(null)
  })

  it("shows an inline error on the saldo card and never calls the global 401 handler", async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    installApiMock({
      "GET /ppob/balance": apiFailure(502, "upstream", "Sesi Mitra expired. Silakan coba lagi."),
      "GET /ppob/history": [PLN_ROW],
    })

    renderHome()

    expect(await screen.findByText(id.ppob.notConfigured)).toBeInTheDocument()
    // The rest of the page is still there — the failure is scoped to the
    // saldo card, not a blank screen.
    expect(screen.getByRole("button", { name: "Pulsa" })).toBeInTheDocument()
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})

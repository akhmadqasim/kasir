import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import type { User } from "@/features/auth/types"
import type { Shift, ShiftSummary } from "./types"

import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useShiftStore } from "./hooks/use-shift-store"
import { CloseShiftPage } from "./components/close-shift-page"

const ADMIN: User = {
  id: 1,
  username: "admin",
  full_name: "Admin",
  role: "admin",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

const SHIFT: Shift = {
  id: 9,
  userId: 1,
  userName: "Admin",
  openingCash: 200_000,
  closingCash: null,
  openedAt: "2026-09-05 01:00:00",
  closedAt: null,
  notes: null,
  status: "open",
}

const SUMMARY: ShiftSummary = {
  shift: SHIFT,
  totalSales: 750_000,
  totalTransactions: 12,
  cashIn: 50_000,
  cashOut: 20_000,
  cashRefunds: 0,
  expectedCash: 980_000,
  cashFlows: [
    {
      id: 1,
      shiftId: 9,
      userId: 1,
      flowType: "in",
      amount: 50_000,
      description: "Tambahan modal dari brankas",
      createdAt: "2026-09-05 02:00:00",
    },
    {
      id: 2,
      shiftId: 9,
      userId: 1,
      flowType: "out",
      amount: 20_000,
      description: "Bayar supplier telur",
      createdAt: "2026-09-05 03:00:00",
    },
  ],
  paymentBreakdown: [{ method: "cash", count: 12, total: 750_000 }],
}

const CLOSED_SUMMARY: ShiftSummary = {
  ...SUMMARY,
  shift: { ...SHIFT, closingCash: 980_000, closedAt: "2026-09-05 09:00:00", status: "closed" },
}

/**
 * The page logs out through a mutation now, and a mutation needs a client — the
 * Tauri version called the store directly and needed no provider here.
 */
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/close-shift"]}>
        <CloseShiftPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

/** Membuka dialog konfirmasi pertama dan menunggu sampai muncul. */
async function openCloseChain() {
  await screen.findByText("Tutup Shift")
  fireEvent.click(screen.getByRole("button", { name: "Tutup Kasir" }))
  return screen.findByRole("alertdialog")
}

let api: ApiMock

beforeEach(() => {
  api = installApiMock({
    "GET /store": { name: "Toko Berkah" },
    "GET /shifts/*/summary": SUMMARY,
    "POST /shifts/*/close": CLOSED_SUMMARY,
    "DELETE /cash-flows/*": null,
    "POST /auth/logout": null,
  })
  useAuthStore.setState({ user: ADMIN })
  useShiftStore.setState({ activeShift: SHIFT })
})

/**
 * Menutup shift tidak bisa dibatalkan: kas terkunci dan laporan langsung dibuat.
 * Yang dijaga di sini adalah rantai konfirmasinya — dua dialog berurutan, dan
 * `POST /shifts/:id/close` baru dipanggil setelah keduanya dilewati.
 */
describe("halaman tutup kasir", () => {
  it("meminta dua konfirmasi sebelum menutup shift", async () => {
    renderPage()

    const review = await openCloseChain()
    expect(within(review).getByText("Konfirmasi Tutup Kasir")).toBeInTheDocument()
    // Ringkasan yang dibaca ulang kasir sebelum lanjut.
    expect(within(review).getByText("Saldo aplikasi")).toBeInTheDocument()
    expect(api.callsFor("POST /shifts/*/close")).toHaveLength(0)

    fireEvent.click(within(review).getByRole("button", { name: "Lanjutkan" }))

    const final = await screen.findByRole("alertdialog")
    expect(within(final).getByText("Verifikasi Terakhir")).toBeInTheDocument()
    expect(screen.queryByText("Konfirmasi Tutup Kasir")).not.toBeInTheDocument()
    expect(api.callsFor("POST /shifts/*/close")).toHaveLength(0)

    fireEvent.click(within(final).getByRole("button", { name: "Ya, Tutup Kasir" }))

    await vi.waitFor(() => {
      const call = api.lastCall("POST /shifts/*/close")
      expect(call?.path).toBe("/shifts/9/close")
      // Saldo dan catatan dibiarkan kosong, jadi keduanya tidak ikut terkirim.
      expect(call?.body).toEqual({})
    })
    // Rantai selesai: laporan menggantikan formulir, dialog ikut tertutup.
    expect(await screen.findByText("Laporan Tutup Kasir")).toBeInTheDocument()
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("membatalkan di langkah pertama tidak menutup shift", async () => {
    renderPage()

    const review = await openCloseChain()
    fireEvent.click(within(review).getByRole("button", { name: "Batal" }))

    await vi.waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    })
    expect(api.callsFor("POST /shifts/*/close")).toHaveLength(0)
  })

  it("membatalkan di langkah kedua membuang seluruh rantai, bukan mundur satu langkah", async () => {
    renderPage()

    const review = await openCloseChain()
    fireEvent.click(within(review).getByRole("button", { name: "Lanjutkan" }))

    const final = await screen.findByRole("alertdialog")
    fireEvent.click(within(final).getByRole("button", { name: "Kembali" }))

    await vi.waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    })
    expect(api.callsFor("POST /shifts/*/close")).toHaveLength(0)
  })

  it("mengirim saldo aktual yang diketik dan menampilkan selisihnya", async () => {
    renderPage()

    await screen.findByText("Tutup Shift")
    fireEvent.change(screen.getByLabelText("Saldo Aktual"), { target: { value: "1000000" } })

    // Selisih dihitung terhadap saldo aplikasi (980.000).
    expect(screen.getByText(/\+Rp\s?20\.000/)).toBeInTheDocument()

    const review = await openCloseChain()
    fireEvent.click(within(review).getByRole("button", { name: "Lanjutkan" }))
    const final = await screen.findByRole("alertdialog")
    fireEvent.click(within(final).getByRole("button", { name: "Ya, Tutup Kasir" }))

    await vi.waitFor(() => {
      const call = api.lastCall("POST /shifts/*/close")
      expect(call?.path).toBe("/shifts/9/close")
      expect(call?.body).toEqual({ closingCash: 1_000_000 })
    })
  })

  it("meminta konfirmasi terpisah sebelum menghapus arus kas", async () => {
    renderPage()

    await screen.findByText("Tutup Shift")
    fireEvent.click(
      screen.getByRole("button", { name: "Hapus arus kas Bayar supplier telur" })
    )

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Hapus Arus Kas")).toBeInTheDocument()
    expect(api.callsFor("DELETE /cash-flows/*")).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole("button", { name: "Hapus" }))

    await vi.waitFor(() => {
      // Pemiliknya diambil dari sesi, jadi yang tersisa cuma id entrinya di path.
      expect(api.lastCall("DELETE /cash-flows/*")?.path).toBe("/cash-flows/2")
    })
  })
})

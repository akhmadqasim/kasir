import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { id } from "@/i18n/id"
import { apiFailure, installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import type { User } from "@/features/auth/types"
import type { Shift, ShiftSummary } from "./types"

import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useCartStore } from "@/stores/cart-store"
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
        <TestNavbar>
          <CloseShiftPage />
        </TestNavbar>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Membuka dialog konfirmasi pertama dan menunggu sampai muncul. */
async function openCloseChain() {
  await screen.findByText(id.shift.close.title)
  fireEvent.click(screen.getByRole("button", { name: id.shift.close.submit }))
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
    expect(within(review).getByText(id.shift.close.reviewTitle)).toBeInTheDocument()
    // Ringkasan yang dibaca ulang kasir sebelum lanjut.
    expect(within(review).getByText(id.shift.close.expectedCash)).toBeInTheDocument()
    expect(api.callsFor("POST /shifts/*/close")).toHaveLength(0)

    fireEvent.click(within(review).getByRole("button", { name: id.shift.close.continue }))

    const final = await screen.findByRole("alertdialog")
    expect(within(final).getByText(id.shift.close.finalTitle)).toBeInTheDocument()
    expect(screen.queryByText(id.shift.close.reviewTitle)).not.toBeInTheDocument()
    expect(api.callsFor("POST /shifts/*/close")).toHaveLength(0)

    fireEvent.click(within(final).getByRole("button", { name: id.shift.close.confirm }))

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
    fireEvent.click(within(review).getByRole("button", { name: id.common.cancel }))

    await vi.waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    })
    expect(api.callsFor("POST /shifts/*/close")).toHaveLength(0)
  })

  it("membatalkan di langkah kedua membuang seluruh rantai, bukan mundur satu langkah", async () => {
    renderPage()

    const review = await openCloseChain()
    fireEvent.click(within(review).getByRole("button", { name: id.shift.close.continue }))

    const final = await screen.findByRole("alertdialog")
    fireEvent.click(within(final).getByRole("button", { name: id.common.cancel }))

    await vi.waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    })
    expect(api.callsFor("POST /shifts/*/close")).toHaveLength(0)
  })

  it("mengirim saldo aktual yang diketik dan menampilkan selisihnya", async () => {
    renderPage()

    await screen.findByText(id.shift.close.title)
    fireEvent.change(screen.getByLabelText(id.shift.close.closingCash), {
      target: { value: "1000000" },
    })

    // Selisih dihitung terhadap saldo aplikasi (980.000).
    expect(screen.getByText(/\+Rp\s?20\.000/)).toBeInTheDocument()

    const review = await openCloseChain()
    fireEvent.click(within(review).getByRole("button", { name: id.shift.close.continue }))
    const final = await screen.findByRole("alertdialog")
    fireEvent.click(within(final).getByRole("button", { name: id.shift.close.confirm }))

    await vi.waitFor(() => {
      const call = api.lastCall("POST /shifts/*/close")
      expect(call?.path).toBe("/shifts/9/close")
      expect(call?.body).toEqual({ closingCash: 1_000_000 })
    })
  })

  it("meminta konfirmasi terpisah sebelum menghapus arus kas", async () => {
    renderPage()

    await screen.findByText(id.shift.close.title)
    fireEvent.click(screen.getByRole("button", { name: "Hapus arus kas Bayar supplier telur" }))

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Hapus Arus Kas")).toBeInTheDocument()
    expect(api.callsFor("DELETE /cash-flows/*")).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole("button", { name: "Hapus" }))

    await vi.waitFor(() => {
      // Pemiliknya diambil dari sesi, jadi yang tersisa cuma id entrinya di path.
      expect(api.lastCall("DELETE /cash-flows/*")?.path).toBe("/cash-flows/2")
    })
  })

  it("menutup dialog hapus arus kas walau ringkasan gagal dimuat ulang", async () => {
    renderPage()

    await screen.findByText(id.shift.close.title)
    // Hapusnya berhasil; yang gagal hanya muat ulang ringkasan sesudahnya.
    api.route("GET /shifts/*/summary", apiFailure(500, "Internal", "boom"))
    fireEvent.click(screen.getByRole("button", { name: "Hapus arus kas Bayar supplier telur" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Hapus" }))

    await vi.waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    })
    expect(api.callsFor("DELETE /cash-flows/*")).toHaveLength(1)
    // Barisnya ikut hilang, dan saldonya dihitung ulang tanpa uang keluar
    // 20.000 itu — tanpa menunggu ringkasan yang gagal dimuat.
    await vi.waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Hapus arus kas Bayar supplier telur" }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByText(/Rp\s?1\.000\.000/)).toBeInTheDocument()
    expect(screen.getByText("Tambahan modal dari brankas")).toBeInTheDocument()
  })

  it("tidak memunculkan lagi baris yang dihapus saat jawaban muat ulang datang terbalik", async () => {
    renderPage()

    await screen.findByText(id.shift.close.title)
    // Setiap muat ulang ditahan sampai tes melepasnya, supaya urutan jawabannya
    // bisa dibalik: jawaban lama (dibaca sebelum hapus kedua) datang terakhir.
    const pending: Array<(summary: ShiftSummary) => void> = []
    api.route("GET /shifts/*/summary", () => new Promise((resolve) => pending.push(resolve)))

    const deleteRow = async (description: string) => {
      fireEvent.click(screen.getByRole("button", { name: `Hapus arus kas ${description}` }))
      const dialog = await screen.findByRole("alertdialog")
      fireEvent.click(within(dialog).getByRole("button", { name: "Hapus" }))
      await vi.waitFor(() => {
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
      })
    }

    await deleteRow("Bayar supplier telur")
    await deleteRow("Tambahan modal dari brankas")
    await vi.waitFor(() => expect(pending).toHaveLength(2))

    const [first, second] = SUMMARY.cashFlows
    await act(async () => {
      pending[1]({ ...SUMMARY, cashIn: 0, cashOut: 0, expectedCash: 950_000, cashFlows: [] })
    })
    await act(async () => {
      pending[0]({ ...SUMMARY, cashOut: 0, expectedCash: 1_000_000, cashFlows: [first] })
    })

    expect(screen.queryByText(first.description)).not.toBeInTheDocument()
    expect(screen.queryByText(second.description)).not.toBeInTheDocument()
    expect(screen.getByText("Belum ada uang masuk atau keluar")).toBeInTheDocument()
  })

  it("menampilkan pesan gagal dengan tombol coba lagi saat ringkasan tidak termuat", async () => {
    api.route("GET /shifts/*/summary", apiFailure(503, "Unavailable", "Server sedang sibuk"))
    renderPage()

    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText("Gagal memuat ringkasan shift")).toBeInTheDocument()
    expect(within(alert).getByText("Server sedang sibuk")).toBeInTheDocument()

    api.route("GET /shifts/*/summary", SUMMARY)
    fireEvent.click(within(alert).getByRole("button", { name: "Coba lagi" }))

    expect(await screen.findByText(id.shift.close.title)).toBeInTheDocument()
    expect(api.callsFor("GET /shifts/*/summary")).toHaveLength(2)
  })

  // The summary used to be keyed on the shift id only, so a refreshed shift
  // (`fetchActiveShift` after a sale or a cash flow elsewhere) left the totals
  // on screen as they were when the page opened.
  it("memuat ulang ringkasan saat data shift aktif diperbarui", async () => {
    renderPage()
    await screen.findByText(id.shift.close.title)
    expect(api.callsFor("GET /shifts/*/summary")).toHaveLength(1)

    api.route("GET /shifts/*/summary", { ...SUMMARY, totalTransactions: 13 })
    act(() => useShiftStore.setState({ activeShift: { ...SHIFT } }))

    await vi.waitFor(() => expect(api.callsFor("GET /shifts/*/summary")).toHaveLength(2))
    expect(await screen.findByText("13")).toBeInTheDocument()
    // Loading never touches the store, so nothing asks again on its own.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(api.callsFor("GET /shifts/*/summary")).toHaveLength(2)
  })

  // Opened straight from its address there is no page of ours behind it; a
  // bare `navigate(-1)` left the cashier stuck (or stepped out of the app).
  it("Kembali tanpa riwayat di aplikasi membuka halaman awal peran", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/close-shift"]}>
          <TestNavbar>
            <Routes>
              <Route element={<CloseShiftPage />} path="/close-shift" />
              <Route element={<p>Dashboard</p>} path="/dashboard" />
            </Routes>
          </TestNavbar>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findByText(id.shift.close.title)

    fireEvent.click(screen.getAllByRole("button", { name: /Kembali/ })[0])

    expect(await screen.findByText("Dashboard")).toBeInTheDocument()
  })

  // Only the cashier screen used to load the shift. Opened from its address,
  // reloaded, or resumed after a restart, the store was still empty and the
  // page bounced home without asking the server.
  it("memuat shift aktif sendiri saat dibuka langsung dari alamatnya", async () => {
    useShiftStore.setState({ activeShift: null })
    api.route("GET /shifts/active", SHIFT)
    renderPage()

    expect(await screen.findByText(id.shift.close.title)).toBeInTheDocument()
    expect(api.callsFor("GET /shifts/active")).toHaveLength(1)
  })

  it("kembali ke halaman awal saat server menjawab tidak ada shift terbuka", async () => {
    useShiftStore.setState({ activeShift: null })
    api.route("GET /shifts/active", null)
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/close-shift"]}>
          <TestNavbar>
            <Routes>
              <Route element={<CloseShiftPage />} path="/close-shift" />
              <Route element={<p>Dashboard</p>} path="/dashboard" />
            </Routes>
          </TestNavbar>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText("Dashboard")).toBeInTheDocument()
    expect(api.callsFor("GET /shifts/active")).toHaveLength(1)
  })

  it("menyebut arah selisih dengan kata, bukan warna saja", async () => {
    renderPage()

    await screen.findByText(id.shift.close.title)
    fireEvent.change(screen.getByLabelText(id.shift.close.closingCash), {
      target: { value: "975000" },
    })
    expect(screen.getByText(/Kurang\s-Rp\s?5\.000/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(id.shift.close.closingCash), {
      target: { value: "980000" },
    })
    expect(screen.getByText("Sesuai")).toBeInTheDocument()
  })

  it("tombol Keluar di laporan tutup shift mengosongkan keranjang", async () => {
    useCartStore.setState({ items: [{ product_id: 1 }] as never })
    renderPage()

    const review = await openCloseChain()
    fireEvent.click(within(review).getByRole("button", { name: id.shift.close.continue }))
    const final = await screen.findByRole("alertdialog")
    fireEvent.click(within(final).getByRole("button", { name: id.shift.close.confirm }))

    fireEvent.click(await screen.findByRole("button", { name: /Keluar/ }))

    await vi.waitFor(() => {
      expect(api.callsFor("POST /auth/logout")).toHaveLength(1)
      expect(useCartStore.getState().items).toHaveLength(0)
    })
  })
})

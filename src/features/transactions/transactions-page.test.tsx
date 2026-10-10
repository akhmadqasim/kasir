import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import type { PaginatedTransactions, TransactionDetail } from "./types"

import { TransactionsPage } from "./components/transactions-page"

/** Satu halaman berisi dua transaksi: satu selesai, satu sudah dihapus. */
const PAGE: PaginatedTransactions = {
  data: [
    {
      id: 1,
      receipt_number: "TRX-20260905-0001",
      user_id: 1,
      cashier_name: "Ahmad",
      total_amount: 25000,
      subtotal_amount: 25000,
      discount_amount: 0,
      payment_method: "cash",
      payment_amount: 25000,
      change_amount: 0,
      status: "completed",
      channel: "sales",
      item_count: 2,
      notes: null,
      created_at: "2026-09-05 03:00:00",
      has_refundable_goods: true,
      has_refundable_failed_ppob: false,
      ppob_service_type: null,
      ppob_advice: null,
      has_ppob: false,
      ppob_status: null,
      ppob_message: null,
      ppob_serial_number: null,
      deleted_at: null,
      deleted_reason: null,
      payment_breakdown: [],
    },
    {
      id: 2,
      receipt_number: "TRX-20260905-0002",
      user_id: 1,
      cashier_name: "Budi",
      total_amount: 12000,
      subtotal_amount: 12000,
      discount_amount: 0,
      payment_method: "qris",
      payment_amount: 12000,
      change_amount: 0,
      status: "deleted",
      channel: "sales",
      item_count: 1,
      notes: null,
      created_at: "2026-09-05 04:00:00",
      has_refundable_goods: true,
      has_refundable_failed_ppob: false,
      ppob_service_type: null,
      ppob_advice: null,
      has_ppob: false,
      ppob_status: null,
      ppob_message: null,
      ppob_serial_number: null,
      deleted_at: "2026-09-05 05:00:00",
      deleted_reason: "Salah input",
      payment_breakdown: [],
    },
  ],
  total: 2,
  page: 1,
  per_page: 50,
  total_pages: 3,
}

/**
 * Isi dialog detail untuk transaksi pertama.
 *
 * Dulu detailnya cukup dibalas `null`; sekarang `GET /transactions/{id}` harus
 * membalas bentuk yang utuh, karena badan kosong berarti 204 dan React Query
 * menolak data `undefined`.
 */
const DETAIL: TransactionDetail = {
  transaction: {
    id: 1,
    receipt_number: "TRX-20260905-0001",
    user_id: 1,
    total_amount: 25000,
    subtotal_amount: 25000,
    discount_amount: 0,
    payment_method: "cash",
    payment_amount: 25000,
    change_amount: 0,
    status: "completed",
    channel: "sales",
    notes: null,
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    updated_at: null,
    created_at: "2026-09-05 03:00:00",
  },
  items: [],
  cashier_name: "Ahmad",
  has_refundable_goods: false,
  has_refundable_failed_ppob: false,
  has_ppob: false,
  ppob_status: null,
  ppob_message: null,
  ppob_serial_number: null,
  payment_breakdown: [{ payment_method: "cash", amount: 25000 }],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {/* Tombol muat ulang dipasang lewat portal ke navbar. */}
        <TestNavbar>
          <TransactionsPage />
        </TestNavbar>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let api: ApiMock

/** The first row's refund action, named with its receipt number. */
const REFUND_FIRST_ROW = /^Refund \/ Tukar Barang TRX-20260905-0001/

/** Nomor halaman dari setiap `GET /transactions`, urut waktu. */
function requestedPages(): number[] {
  return api.callsFor("GET /transactions").map((call) => Number(call.query.get("page")))
}

beforeEach(() => {
  api = installApiMock({
    "GET /transactions": PAGE,
    "GET /transactions/*": DETAIL,
  })
})

/**
 * Riwayat transaksi berjalan di atas `Table` HeroUI, yang berarti barisnya adalah
 * koleksi React Aria, bukan `<tr>` biasa yang diberi `onClick`. Yang dijaga di sini
 * adalah hal-hal yang bisa hilang diam-diam saat pindah: baris tetap bisa dicapai
 * dan dibuka lewat keyboard, dan navigasi halaman tahu kapan harus mati.
 */
describe("halaman riwayat transaksi", () => {
  it("menampilkan setiap transaksi sebagai baris tabel", async () => {
    renderPage()

    expect(await screen.findByText("TRX-20260905-0001")).toBeInTheDocument()
    expect(screen.getByText("TRX-20260905-0002")).toBeInTheDocument()
    expect(screen.getByText("Alasan hapus: Salah input")).toBeInTheDocument()
  })

  it("membuka detail transaksi lewat keyboard, bukan hanya klik", async () => {
    renderPage()

    const cell = await screen.findByText("TRX-20260905-0001")
    const row = cell.closest("tr")
    expect(row).not.toBeNull()
    // React Aria memberi baris roving tabindex; tanpa ini baris hanya bisa diklik.
    expect(row).toHaveAttribute("tabindex")

    fireEvent.keyDown(row!, { key: "Enter" })
    fireEvent.keyUp(row!, { key: "Enter" })

    expect(await screen.findByRole("dialog")).toBeInTheDocument()
  })

  it("mematikan tombol sebelumnya di halaman pertama dan tetap membuka halaman berikutnya", async () => {
    renderPage()

    await screen.findByText("TRX-20260905-0001")
    const pagination = screen.getByRole("navigation", { name: "Navigasi halaman" })

    expect(within(pagination).getByText("Halaman 1 dari 3")).toBeInTheDocument()
    expect(within(pagination).getByRole("button", { name: /Sebelumnya/ })).toBeDisabled()
    expect(within(pagination).getByRole("button", { name: /Selanjutnya/ })).toBeEnabled()
  })

  it("meminta halaman berikutnya ke backend saat tombolnya ditekan", async () => {
    renderPage()

    await screen.findByText("TRX-20260905-0001")
    const next = screen.getByRole("button", { name: /Selanjutnya/ })
    fireEvent.click(next)

    await screen.findByText("TRX-20260905-0001")
    await vi.waitFor(() => expect(requestedPages()).toContain(2))
  })

  /**
   * A bill paid on the PPOB page is a transaction too, but not a sale of goods:
   * the history asks for `channel=sales` unless the cashier switches the view.
   */
  it("hanya meminta transaksi penjualan, dan bisa beralih ke PPOB", async () => {
    renderPage()

    await screen.findByText("TRX-20260905-0001")
    expect(api.lastCall("GET /transactions")?.query.get("channel")).toBe("sales")

    fireEvent.click(screen.getByRole("radio", { name: "PPOB" }))

    await vi.waitFor(() =>
      expect(api.lastCall("GET /transactions")?.query.get("channel")).toBe("ppob"),
    )

    fireEvent.click(screen.getByRole("radio", { name: "Semua" }))

    await vi.waitFor(() =>
      expect(api.lastCall("GET /transactions")?.query.has("channel")).toBe(false),
    )
  })

  it("menamai aksi baris dengan nomor struknya", async () => {
    renderPage()

    await screen.findByText("TRX-20260905-0001")
    expect(
      screen.getByRole("button", { name: "Lihat detail TRX-20260905-0001" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Cetak Struk TRX-20260905-0002" }),
    ).toBeInTheDocument()
  })

  it("tidak menawarkan refund untuk penjualan yang barangnya sudah kembali semua", async () => {
    // A mixed cart whose goods all came back: its PPOB line keeps it at
    // `partial_refund`, so only `has_refundable_goods` tells it is done.
    const [first, second] = PAGE.data
    const settled = { ...first, status: "partial_refund", has_refundable_goods: false }
    api.route("GET /transactions", { ...PAGE, data: [settled, second] })
    renderPage()

    await screen.findByText("TRX-20260905-0001")
    expect(screen.queryAllByRole("button", { name: REFUND_FIRST_ROW })).toHaveLength(0)
  })

  it("menawarkan refund selama masih ada barang yang bisa dikembalikan", async () => {
    renderPage()

    await screen.findByText("TRX-20260905-0001")
    expect(screen.queryAllByRole("button", { name: REFUND_FIRST_ROW }).length).toBeGreaterThan(0)
  })

  it("menawarkan refund untuk top-up gagal yang dibeli di halaman PPOB", async () => {
    // A PPOB-page sale whose top-up failed: the server says it can come back.
    const [first, second] = PAGE.data
    const failedTopUp = {
      ...first,
      channel: "ppob" as const,
      has_ppob: true,
      ppob_status: "failed",
    }
    api.route("GET /transactions", { ...PAGE, data: [failedTopUp, second] })
    renderPage()

    await screen.findByText("TRX-20260905-0001")
    expect(screen.queryAllByRole("button", { name: REFUND_FIRST_ROW }).length).toBeGreaterThan(0)
  })

  it("menawarkan reset filter saat hasil kosong karena filter", async () => {
    api.route("GET /transactions", { ...PAGE, data: [], total: 0, total_pages: 1 })
    renderPage()

    fireEvent.click(await screen.findByRole("radio", { name: "PPOB" }))

    expect(await screen.findByText("Tidak ada transaksi yang cocok")).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: /Hapus filter/ }).at(-1)!)

    await vi.waitFor(() =>
      expect(api.lastCall("GET /transactions")?.query.get("channel")).toBe("sales"),
    )
  })
})

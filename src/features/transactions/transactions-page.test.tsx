import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import type { PaginatedTransactions } from "./types"

const invoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args),
}))

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
      item_count: 2,
      notes: null,
      created_at: "2026-09-05 03:00:00",
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
      item_count: 1,
      notes: null,
      created_at: "2026-09-05 04:00:00",
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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TransactionsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockImplementation((command: string) => {
    if (command === "list_transactions") return Promise.resolve(PAGE)
    if (command === "get_transaction_detail") return Promise.resolve(null)
    return Promise.resolve(null)
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
    const pagination = screen.getByRole("navigation", { name: "pagination" })

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
    const pages = invoke.mock.calls
      .filter(([command]) => command === "list_transactions")
      .map(([, args]) => (args as { input: { page: number } }).input.page)
    expect(pages).toContain(2)
  })
})

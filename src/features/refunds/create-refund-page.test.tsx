import { beforeEach, describe, expect, it } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { installApiMock } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import type { PaginatedProducts, Product } from "@/features/products/types"
import type { TransactionDetail, TransactionDetailItem } from "@/features/transactions/types"

import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { CreateRefundPage } from "./components/create-refund-page"

function product(id: number, name: string): Product {
  return {
    id,
    barcode: null,
    sku: null,
    name,
    category_id: null,
    buy_price: 8000,
    sell_price: 12000,
    margin: 0,
    stock: 40,
    unit: "pcs",
    min_stock: 0,
    is_active: true,
    created_at: "2026-09-05 00:00:00",
    updated_at: "2026-09-05 00:00:00",
  }
}

const SOLD_ITEM: TransactionDetailItem = {
  id: 11,
  transaction_id: 7,
  product_id: 3,
  product_name: "Minyak Goreng 1L",
  product_price: 15000,
  buy_price: 12000,
  quantity: 2,
  subtotal: 30000,
  item_discount: 0,
  net_subtotal: 30000,
  service_type: null,
  service_ref: null,
  ppob_product_id: null,
  ppob_product_code: null,
  ppob_inquiry_id: null,
  ppob_payment_code: null,
  ppob_flag_id: null,
  ppob_status: null,
  ppob_message: null,
  ppob_serial_number: null,
  created_at: "2026-09-05 03:00:00",
  refunded_quantity: 0,
}

const DETAIL: TransactionDetail = {
  transaction: {
    id: 7,
    receipt_number: "TRX-20260905-0007",
    user_id: 1,
    total_amount: 30000,
    subtotal_amount: 30000,
    discount_amount: 0,
    payment_method: "cash",
    payment_amount: 30000,
    change_amount: 0,
    status: "completed",
    channel: "sales",
    notes: null,
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    updated_at: null,
    created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
  },
  items: [SOLD_ITEM],
  cashier_name: "Ahmad",
  has_ppob: false,
  ppob_status: null,
  ppob_message: null,
  ppob_serial_number: null,
  payment_breakdown: [],
}

const SEARCH_RESULTS: PaginatedProducts = {
  data: [product(3, "Minyak Goreng 2L"), product(4, "Gula Pasir 1kg")],
  total: 2,
  page: 1,
  per_page: 5,
  total_pages: 1,
}

/** `history` is what came before the refund page; empty = opened directly. */
function renderPage(path = "/refund/7", history: string[] = []) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[...history, path]} initialIndex={history.length}>
        {/* Halaman memasang judul dan tombol kembali lewat portal ke navbar. */}
        <TestNavbar>
          <Routes>
            <Route path="/refund/:transactionId" element={<CreateRefundPage />} />
            <Route path="/transactions" element={<p>Halaman riwayat transaksi</p>} />
            <Route path="/refunds" element={<p>Halaman riwayat refund</p>} />
          </Routes>
        </TestNavbar>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Mengganti tipe aksi ke "Tukar Barang" lewat `ToggleButtonGroup` (radiogroup). */
async function chooseExchange() {
  const group = await screen.findByRole("radiogroup", { name: "Tipe" })
  fireEvent.click(within(group).getByRole("radio", { name: /Tukar Barang/ }))
}

/** Membuka pencarian barang pengganti dan mengetik kueri. */
async function searchReplacement(query: string) {
  fireEvent.click(screen.getByRole("button", { name: /Barang Pengganti$/ }))
  const input = await screen.findByRole("searchbox")
  fireEvent.change(input, { target: { value: query } })
}

function exchangeTable() {
  return screen.getByRole("grid", { name: "Barang Pengganti" })
}

beforeEach(() => {
  installApiMock({
    "GET /transactions/*": DETAIL,
    "GET /products": SEARCH_RESULTS,
  })
  useAuthStore.setState({
    user: {
      id: 1,
      username: "admin",
      full_name: "Admin",
      role: "admin",
      is_active: true,
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00",
    },
  })
})

/**
 * Barang pengganti dulu dipilih lewat dropdown rakitan tangan. Yang dijaga di sini
 * adalah alurnya, bukan komponennya: barang yang dipilih masuk ke daftar, bisa
 * dibuang lagi, dan tombol proses tetap mati selama syaratnya belum lengkap.
 */
describe("halaman refund", () => {
  it("memindahkan barang yang dipilih ke daftar barang pengganti", async () => {
    renderPage()

    await screen.findByText("TRX-20260905-0007")
    await chooseExchange()
    await searchReplacement("minyak")

    fireEvent.click(await screen.findByRole("option", { name: /Minyak Goreng 2L/ }))

    expect(within(exchangeTable()).getByText("Minyak Goreng 2L")).toBeInTheDocument()
  })

  it("mengosongkan pencarian setelah memilih, supaya barang berikutnya bisa dicari", async () => {
    renderPage()

    await screen.findByText("TRX-20260905-0007")
    await chooseExchange()
    await searchReplacement("minyak")
    fireEvent.click(await screen.findByRole("option", { name: /Minyak Goreng 2L/ }))

    // Pemicu kembali ke placeholder-nya: tidak ada pilihan yang tertinggal.
    expect(screen.getByRole("button", { name: /Barang Pengganti$/ })).toHaveAccessibleName(
      /Tambah Barang/,
    )

    await searchReplacement("gula")
    fireEvent.click(await screen.findByRole("option", { name: /Gula Pasir 1kg/ }))

    const table = within(exchangeTable())
    expect(table.getByText("Minyak Goreng 2L")).toBeInTheDocument()
    expect(table.getByText("Gula Pasir 1kg")).toBeInTheDocument()
  })

  it("membuang barang pengganti dari daftar", async () => {
    renderPage()

    await screen.findByText("TRX-20260905-0007")
    await chooseExchange()
    await searchReplacement("minyak")
    fireEvent.click(await screen.findByRole("option", { name: /Minyak Goreng 2L/ }))

    fireEvent.click(within(exchangeTable()).getByRole("button", { name: "Hapus Minyak Goreng 2L" }))

    expect(screen.queryByRole("grid", { name: "Barang Pengganti" })).not.toBeInTheDocument()
  })

  it("menahan tombol proses sampai ada barang diretur dan barang pengganti", async () => {
    renderPage()

    await screen.findByText("TRX-20260905-0007")
    await chooseExchange()
    expect(screen.getByRole("button", { name: "Proses Tukar Barang" })).toBeDisabled()

    await searchReplacement("minyak")
    fireEvent.click(await screen.findByRole("option", { name: /Minyak Goreng 2L/ }))
    // Barang pengganti sudah ada, tapi belum ada barang yang diretur.
    expect(screen.getByRole("button", { name: "Proses Tukar Barang" })).toBeDisabled()

    fireEvent.click(screen.getByRole("checkbox", { name: /Minyak Goreng 1L/ }))
    expect(screen.getByRole("button", { name: "Proses Tukar Barang" })).toBeEnabled()
  })
})

/**
 * Detail transaksi sekarang membawa `refunded_quantity` per baris, jadi batas
 * jumlah di formulir langsung memakai sisa yang benar — bukan jumlah beli yang
 * baru dikoreksi setelah server menolak.
 */
describe("barang yang sudah pernah diretur", () => {
  const PARTLY_REFUNDED: TransactionDetail = {
    ...DETAIL,
    transaction: { ...DETAIL.transaction, status: "partial_refund" },
    items: [
      { ...SOLD_ITEM, quantity: 3, subtotal: 45000, net_subtotal: 45000, refunded_quantity: 2 },
      {
        ...SOLD_ITEM,
        id: 12,
        product_id: 4,
        product_name: "Gula Pasir 1kg",
        quantity: 1,
        subtotal: 15000,
        net_subtotal: 15000,
        refunded_quantity: 1,
      },
    ],
  }

  it("menampilkan jumlah yang sudah diretur dan membatasi qty ke sisanya", async () => {
    installApiMock({
      "GET /transactions/*": PARTLY_REFUNDED,
      "GET /products": SEARCH_RESULTS,
    })
    renderPage()

    expect(await screen.findByText("Sudah diretur 2, sisa 1")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("checkbox", { name: /Minyak Goreng 1L/ }))
    expect(screen.getByText("Maks. 1")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: /Qty Refund/ })).toHaveValue("1")
  })

  it("mengunci baris yang sudah diretur seluruhnya", async () => {
    installApiMock({
      "GET /transactions/*": PARTLY_REFUNDED,
      "GET /products": SEARCH_RESULTS,
    })
    renderPage()

    expect(await screen.findByText("Sudah diretur seluruhnya")).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: /Gula Pasir 1kg/ })).toBeDisabled()
    expect(screen.getByRole("checkbox", { name: /Minyak Goreng 1L/ })).toBeEnabled()
  })
})

describe("alamat refund yang salah", () => {
  // `/refund/abc` used to sit on skeletons forever; loading again cannot fix it.
  it("memberi tahu nomornya tidak valid tanpa tombol coba lagi", async () => {
    renderPage("/refund/abc")

    expect(await screen.findByText("Nomor transaksi tidak valid.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Coba lagi" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /Kembali/ }).length).toBeGreaterThan(0)
  })
})

/**
 * `navigate(-1)` on a page opened straight from its address stepped out of the
 * app — in the desktop window, it did nothing and left the cashier stuck.
 */
describe("keluar dari halaman refund", () => {
  it("kembali ke halaman sebelumnya kalau ada", async () => {
    renderPage("/refund/7", ["/refunds"])

    await screen.findByText("TRX-20260905-0007")
    fireEvent.click(screen.getByRole("button", { name: "Batal" }))

    expect(await screen.findByText("Halaman riwayat refund")).toBeInTheDocument()
  })

  it("jatuh ke riwayat transaksi kalau halaman dibuka langsung", async () => {
    renderPage()

    await screen.findByText("TRX-20260905-0007")
    fireEvent.click(screen.getByRole("button", { name: "Batal" }))

    expect(await screen.findByText("Halaman riwayat transaksi")).toBeInTheDocument()
  })

  it("tombol kembali di navbar juga jatuh ke riwayat transaksi", async () => {
    renderPage()

    await screen.findByText("TRX-20260905-0007")
    fireEvent.click(screen.getByRole("button", { name: "Kembali" }))

    expect(await screen.findByText("Halaman riwayat transaksi")).toBeInTheDocument()
  })
})

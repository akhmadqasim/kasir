import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import { formatRupiah } from "@/lib/format"
import type {
  DailyRevenue,
  DashboardSummary,
  LowStockProduct,
  PaymentMethodDaily,
  PaymentMethodStat,
  RecentTransaction,
  TopProduct,
} from "./types"

import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { DashboardPage } from "./components/dashboard-page"

const SUMMARY: DashboardSummary = {
  todayRevenue: 150_000,
  todayTransactions: 12,
  todayRefunds: 0,
  todayRefundAmount: 0,
  yesterdayRevenue: 100_000,
  totalProducts: 40,
  lowStockCount: 2,
  todayGrossProfit: 30_000,
  todayAvgPerTransaction: 12_500,
}

const DAILY_REVENUE: DailyRevenue[] = [
  { date: "2026-09-04", revenue: 100_000, transactions: 8 },
  { date: "2026-09-05", revenue: 150_000, transactions: 12 },
]

const PAYMENT_STATS: PaymentMethodStat[] = [
  { method: "cash", count: 8, total: 200_000 },
  { method: "qris", count: 4, total: 50_000 },
]

const PAYMENT_DAILY: PaymentMethodDaily[] = [
  { date: "2026-09-04", method: "cash", total: 80_000 },
  { date: "2026-09-04", method: "qris", total: 20_000 },
  { date: "2026-09-05", method: "cash", total: 120_000 },
  { date: "2026-09-05", method: "qris", total: 30_000 },
]

const TOP_PRODUCTS: TopProduct[] = [
  { productId: 1, productName: "Beras Pandan Wangi 5kg", totalQty: 7, totalRevenue: 455_000 },
]

const LOW_STOCK: LowStockProduct[] = [
  { id: 1, name: "Gula Pasir 1kg", stock: 0, minStock: 5, unit: "pcs" },
  { id: 2, name: "Minyak Goreng 2L", stock: 3, minStock: 10, unit: "pcs" },
]

const RECENT: RecentTransaction[] = [
  {
    id: 1,
    receiptNumber: "TRX-20260905-0001",
    totalAmount: 25_000,
    paymentMethod: "cash",
    status: "completed",
    cashierName: "Ahmad",
    createdAt: "2026-09-05 03:00:00",
    totalItems: 2,
  },
  {
    id: 2,
    receiptNumber: "TRX-20260905-0002",
    totalAmount: 12_000,
    paymentMethod: "qris",
    status: "partial_refund",
    cashierName: "Budi",
    createdAt: "2026-09-05 04:00:00",
    totalItems: 1,
  },
]

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TestNavbar>
          <DashboardPage />
        </TestNavbar>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/**
 * `formatRupiah` memisahkan "Rp" dari angkanya dengan NBSP. Testing Library
 * menormalkan teks DOM (NBSP jadi spasi biasa) tapi tidak menormalkan string
 * pencarinya, jadi tanpa ini tidak ada satu pun nominal yang ketemu.
 */
function rupiah(amount: number): string {
  return formatRupiah(amount).split(String.fromCharCode(160)).join(" ")
}

let api: ApiMock

/** Parameter `days` dari setiap permintaan ke sebuah rute, urut waktu. */
function requestedDays(route: string): number[] {
  return api.callsFor(route).map((call) => Number(call.query.get("days")))
}

/** Membuka salah satu tab dashboard dan menunggu panelnya tergambar. */
function openTab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }))
}

beforeEach(() => {
  api = installApiMock({
    "GET /dashboard/summary": SUMMARY,
    "GET /dashboard/revenue/daily": DAILY_REVENUE,
    "GET /dashboard/payment-methods": PAYMENT_STATS,
    "GET /dashboard/payment-methods/daily": PAYMENT_DAILY,
    "GET /dashboard/products/top": TOP_PRODUCTS,
    "GET /dashboard/products/low-stock": LOW_STOCK,
    "GET /dashboard/transactions/recent": RECENT,
  })
  useAuthStore.setState({
    user: {
      id: 1,
      username: "admin",
      full_name: "Admin Toko",
      role: "admin",
      is_active: true,
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00",
    },
  })
})

/**
 * Dashboard adalah layar pertama yang dilihat kasir tiap pagi, dan satu-satunya
 * yang masih memakai recharts di atas komponen HeroUI. Yang dijaga di sini
 * adalah hal-hal yang bisa hilang diam-diam: angkanya, kejujuran lencana tren,
 * rentang periode yang harus sama untuk kedua grafik, dan isi tiap tab.
 */
describe("halaman dashboard", () => {
  it("menampilkan angka KPI hari ini beserta trennya", async () => {
    renderPage()

    expect(await screen.findByText(rupiah(150_000))).toBeInTheDocument()
    expect(screen.getByText(rupiah(30_000))).toBeInTheDocument()
    expect(screen.getByText(rupiah(12_500))).toBeInTheDocument()
    // 150k dari 100k kemarin = +50%, margin 30k/150k = 20%.
    expect(screen.getByText("+50.0%")).toBeInTheDocument()
    expect(screen.getByText("20.0%")).toBeInTheDocument()
  })

  /**
   * Regresi yang mudah kembali: versi lama menempelkan panah naik pada keempat
   * kartu, jadi jumlah transaksi tampak tumbuh padahal tidak pernah ada angka
   * kemarin untuk dibandingkan.
   */
  it("tidak menampilkan tren pada angka yang tidak punya pembanding", async () => {
    api.route("GET /dashboard/summary", { ...SUMMARY, yesterdayRevenue: 0 })
    renderPage()

    await screen.findByText(rupiah(150_000))
    // Tidak adanya lencana sudah cukup mengatakan tidak ada yang dibandingkan.
    expect(screen.queryByText(/^[+-]\d/)).not.toBeInTheDocument()
  })

  it("mengirim rentang hari yang sama ke kedua grafik saat periode diganti", async () => {
    renderPage()

    await screen.findByText(rupiah(150_000))
    expect(requestedDays("GET /dashboard/revenue/daily")).toEqual([7])
    expect(requestedDays("GET /dashboard/payment-methods/daily")).toEqual([7])

    fireEvent.click(screen.getByRole("button", { name: /Ganti rentang waktu/ }))
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "1 Bulan" }))

    await vi.waitFor(() => {
      expect(requestedDays("GET /dashboard/revenue/daily")).toContain(30)
      expect(requestedDays("GET /dashboard/payment-methods/daily")).toContain(30)
    })
  })

  it("memberi satu garis per metode pembayaran pada grafik tren", async () => {
    renderPage()

    await screen.findByText(rupiah(150_000))
    const legend = screen.getByRole("list", { name: "Legenda metode pembayaran" })
    expect(within(legend).getByText("Tunai")).toBeInTheDocument()
    expect(within(legend).getByText("QRIS")).toBeInTheDocument()
  })

  it("hanya menandai transaksi yang belum tuntas di tabel terakhir", async () => {
    renderPage()

    await screen.findByText("TRX-20260905-0001")
    const table = within(screen.getByRole("grid", { name: "Transaksi Terakhir" }))
    // Baris `completed` sengaja tanpa lencana: hanya sisanya yang perlu dibaca.
    expect(table.getAllByText("Refund Sebagian")).toHaveLength(1)
    expect(table.queryByText("Selesai")).not.toBeInTheDocument()
  })

  it("menyimpan produk terlaris dan rincian pembayaran di tab Penjualan", async () => {
    renderPage()

    await screen.findByText(rupiah(150_000))
    expect(screen.queryByText("Beras Pandan Wangi 5kg")).not.toBeInTheDocument()

    openTab("Penjualan")

    expect(await screen.findByText("Beras Pandan Wangi 5kg")).toBeInTheDocument()
    const table = within(screen.getByRole("grid", { name: "Metode Pembayaran" }))
    // 200rb dari 250rb yang beredar hari ini.
    expect(table.getByText("80%")).toBeInTheDocument()
  })

  it("membedakan stok habis dari stok menipis di tab Stok", async () => {
    renderPage()

    await screen.findByText(rupiah(150_000))
    openTab("Stok")

    await screen.findByText("Gula Pasir 1kg")
    const table = within(screen.getByRole("grid", { name: "Stok Rendah" }))
    expect(table.getByText("0 pcs")).toBeInTheDocument()
    expect(table.getByText("3 pcs")).toBeInTheDocument()
  })

  it("menyembunyikan aksi khusus admin dari kasir", async () => {
    useAuthStore.setState({
      user: {
        id: 2,
        username: "kasir01",
        full_name: "Kasir Satu",
        role: "kasir",
        is_active: true,
        created_at: "2026-01-01 00:00:00",
        updated_at: "2026-01-01 00:00:00",
      },
    })
    renderPage()

    expect(await screen.findByRole("button", { name: /Mulai Penjualan/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Backup Sekarang/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Kelola Produk/ })).not.toBeInTheDocument()
  })
})

import type { ComponentType } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Table } from "@heroui/react"

import { installApiMock, type ApiRoutes } from "@/test-utils/api-mock"
import { StatCard } from "@/components/stat-card"
import { formatRupiah } from "@/lib/format"

import { ReportPage, ReportTable } from "./components/report-shell"
import { CashFlowsPage } from "./components/cash-flows-page"
import { CurrentStockPage } from "./components/current-stock-page"
import { LossesPage } from "./components/losses-page"
import { PaymentMethodsPage } from "./components/payment-methods-page"
import { PopularProductsPage } from "./components/popular-products-page"
import { ProductSalesPage } from "./components/product-sales-page"
import { ReturnsPage } from "./components/returns-page"
import { SalesDailyPage } from "./components/sales-daily-page"
import { SalesMonthlyPage } from "./components/sales-monthly-page"
import { SalesPeriodPage } from "./components/sales-period-page"
import { SalesReceiptPage } from "./components/sales-receipt-page"

function renderWithQuery(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

/**
 * `Intl` puts a non-breaking space after "Rp". Testing Library normalises that
 * to an ordinary space in the DOM text but not in the string it is matched
 * against, so an unmodified `formatRupiah` result never matches.
 */
function rupiahText(amount: number) {
  return formatRupiah(amount).replace(/\s/g, " ")
}

/** Sel baris = satu sel header baris + sisanya sel data. */
function countCells(row: HTMLElement) {
  const cells = within(row)
  return cells.queryAllByRole("rowheader").length + cells.queryAllByRole("gridcell").length
}

const DAILY_ROWS = [
  {
    date: "2026-09-01",
    transactionCount: 3,
    totalRevenue: 150000,
    totalCost: 100000,
    grossProfit: 50000,
  },
]

/**
 * Satu rute per layar. Rute yang tidak terdaftar membuat permintaannya gagal,
 * sama seperti perintah tak terduga dulu ditolak.
 */
const REPORT_ROUTES: ApiRoutes = {
  "GET /reports/sales/daily": DAILY_ROWS,
  "GET /reports/sales/monthly": [
    {
      month: "2026-09",
      transactionCount: 3,
      totalRevenue: 150000,
      totalCost: 100000,
      grossProfit: 50000,
    },
  ],
  "GET /reports/sales/period": {
    totalTransactions: 3,
    totalRevenue: 150000,
    totalCost: 100000,
    grossProfit: 50000,
    avgPerTransaction: 50000,
    dailyBreakdown: DAILY_ROWS,
  },
  // Struk yang sudah diretur ikut terdaftar sekarang, jadi tiap baris membawa
  // nilai returnya sendiri dan nilai bersih yang benar-benar tinggal di laci.
  "GET /reports/sales/receipts": {
    items: [
      {
        id: 1,
        receiptNumber: "TRX-20260901-0001",
        cashierName: "Ani",
        totalAmount: 50000,
        paymentMethod: "cash",
        status: "completed",
        itemCount: 2,
        createdAt: "2026-09-01 10:00:00",
        refundAmount: 0,
        netAmount: 50000,
      },
      {
        id: 2,
        receiptNumber: "TRX-20260901-0002",
        cashierName: "Ani",
        totalAmount: 25000,
        paymentMethod: "qris",
        status: "refunded",
        itemCount: 1,
        createdAt: "2026-09-01 13:00:00",
        refundAmount: 25000,
        netAmount: 0,
      },
    ],
    totalCount: 2,
  },
  "GET /reports/payment-methods": [
    { paymentMethod: "cash", transactionCount: 2, totalAmount: 100000, percentage: 66.7 },
    { paymentMethod: "qris", transactionCount: 1, totalAmount: 50000, percentage: 33.3 },
  ],
  "GET /reports/products/sales": [
    {
      productId: 1,
      productName: "Gula Pasir",
      barcode: "8991234567890",
      categoryName: "Sembako",
      qtySold: 4,
      totalRevenue: 60000,
      totalCost: 40000,
      profit: 20000,
    },
  ],
  "GET /reports/products/popular": [
    {
      rank: 1,
      productId: 1,
      productName: "Gula Pasir",
      categoryName: "Sembako",
      qtySold: 4,
      totalRevenue: 60000,
    },
  ],
  "GET /reports/returns": [
    {
      id: 1,
      refundNumber: "RFD-20260901-0001",
      transactionReceipt: "TRX-20260901-0001",
      cashierName: "Ani",
      type: "refund",
      totalRefundAmount: 25000,
      reason: "Barang rusak",
      createdAt: "2026-09-01 11:00:00",
    },
  ],
  "GET /reports/stock/current": {
    items: [
      {
        productId: 1,
        barcode: "8991234567890",
        productName: "Gula Pasir",
        categoryName: "Sembako",
        stock: 2,
        minStock: 5,
        unit: "pcs",
        buyPrice: 10000,
        sellPrice: 15000,
        stockValue: 20000,
      },
    ],
    totalCount: 1,
  },
  "GET /reports/losses": {
    totalWriteoffs: 1,
    totalQuantity: 2,
    totalLossValue: 20000,
    byReason: [{ reason: "damaged", count: 1, totalValue: 20000 }],
    items: [
      {
        id: 1,
        writeoffNumber: "WO-20260901-0001",
        productName: "Gula Pasir",
        cashierName: "Ani",
        quantity: 2,
        reason: "damaged",
        lossValue: 20000,
        notes: null,
        status: "approved",
        createdAt: "2026-09-01 12:00:00",
      },
    ],
  },
  "GET /reports/cash-flows": {
    totalIn: 100000,
    totalOut: 40000,
    netTotal: 60000,
    items: [
      {
        id: 1,
        shiftId: 1,
        cashierName: "Ani",
        flowType: "in",
        amount: 100000,
        description: "Modal awal",
        createdAt: "2026-09-01 08:00:00",
      },
    ],
  },
}

interface ReportCase {
  Page: ComponentType
  title: string
  columns: number
  /** Baris di dalam `Table.Body` setelah data masuk, di luar baris header. */
  dataRows: number
}

const REPORT_PAGES: ReportCase[] = [
  { Page: SalesDailyPage, title: "Penjualan per Hari", columns: 5, dataRows: 1 },
  { Page: SalesMonthlyPage, title: "Penjualan per Bulan", columns: 5, dataRows: 1 },
  { Page: SalesPeriodPage, title: "Penjualan per Periode", columns: 5, dataRows: 1 },
  // Tujuh kolom lama plus kolom Retur dan Bersih; dua struk, satu di antaranya diretur.
  { Page: SalesReceiptPage, title: "Penjualan per Struk", columns: 9, dataRows: 2 },
  // Dua metode pembayaran plus baris total di kakinya.
  { Page: PaymentMethodsPage, title: "Jenis Pembayaran", columns: 4, dataRows: 3 },
  { Page: ProductSalesPage, title: "Penjualan Produk", columns: 7, dataRows: 1 },
  { Page: PopularProductsPage, title: "Produk Populer", columns: 5, dataRows: 1 },
  { Page: ReturnsPage, title: "Retur Produk", columns: 7, dataRows: 1 },
  { Page: CurrentStockPage, title: "Stok Saat Ini", columns: 9, dataRows: 1 },
  { Page: LossesPage, title: "Laporan Kerugian", columns: 9, dataRows: 1 },
  { Page: CashFlowsPage, title: "Uang Masuk / Keluar", columns: 5, dataRows: 1 },
]

beforeEach(() => {
  installApiMock(REPORT_ROUTES)
})

/**
 * Kerangka bersama sebelas layar laporan.
 *
 * `columnCount` yang dipakai baris skeleton ditulis terpisah dari kolomnya, jadi
 * kalau ada kolom ditambah tanpa menaikkan angka itu React Aria akan merender
 * baris pincang tanpa mengeluh. Setiap layar karena itu diperiksa dua kali:
 * sekali saat masih skeleton, sekali setelah datanya masuk.
 */
describe("kerangka laporan", () => {
  it("menampilkan kontrol filter tanpa menggambar judul sendiri", () => {
    render(
      <ReportPage filters={<button type="button">Filter</button>}>
        <p>Isi</p>
      </ReportPage>,
    )

    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument()
    // Judul halaman milik navbar `AppLayout`, diturunkan dari rute. `h1` kedua
    // di badan halaman hanya mengulanginya, jadi kerangka ini tidak punya heading.
    expect(screen.queryByRole("heading")).not.toBeInTheDocument()
  })

  it("menulis label kartu ringkasan sebagai teks biasa, bukan heading", () => {
    render(
      <ReportPage>
        <StatCard label="Laba Kotor" tone="success" value="Rp 50.000" />
      </ReportPage>,
    )

    expect(screen.getByText("Laba Kotor")).toBeInTheDocument()
    expect(screen.getByText("Rp 50.000")).toHaveClass("text-success")
    // `Card.Title` HeroUI merender `h3` dan akan melompati tingkat heading di
    // bawah judul navbar, jadi labelnya sengaja `Card.Description`, bukan heading.
    expect(screen.queryByRole("heading")).not.toBeInTheDocument()
  })

  it("membedakan tabel yang gagal dimuat dari tabel yang memang kosong", () => {
    const columns = (
      <>
        <Table.Column isRowHeader>A</Table.Column>
        <Table.Column>B</Table.Column>
      </>
    )

    const { rerender } = render(
      <ReportTable label="Uji" columnCount={2} columns={columns} isLoading={false}>
        {[]}
      </ReportTable>,
    )
    expect(screen.getByText("Tidak ada data")).toBeInTheDocument()

    rerender(
      <ReportTable
        label="Uji"
        columnCount={2}
        columns={columns}
        isLoading={false}
        error={new Error("koneksi database putus")}
      >
        {[]}
      </ReportTable>,
    )
    expect(screen.getByText("Error: koneksi database putus")).toBeInTheDocument()
    expect(screen.queryByText("Tidak ada data")).not.toBeInTheDocument()
  })

  it.each(REPORT_PAGES)(
    "$title: jumlah sel baris skeleton dan baris data sama dengan jumlah kolom",
    async ({ Page, title, columns, dataRows }) => {
      renderWithQuery(<Page />)

      // Belum ada `await` di sini, jadi query-nya masih tertahan di status memuat
      // dan yang tampil pasti baris skeleton.
      const grid = screen.getByRole("grid", { name: title })
      expect(within(grid).getAllByRole("columnheader")).toHaveLength(columns)
      expect(countCells(within(grid).getAllByRole("row")[1])).toBe(columns)

      await waitFor(() => {
        expect(within(grid).getAllByRole("row")).toHaveLength(dataRows + 1)
      })
      expect(countCells(within(grid).getAllByRole("row")[1])).toBe(columns)
    },
  )
})

/**
 * Report figures are now net of refunds, and a return is subtracted on the day
 * it was taken rather than the day of the sale. A period that saw only returns
 * therefore produces rows nothing in these screens used to expect: a payment
 * method with no transactions and a negative total, and a product with a
 * negative quantity sold.
 *
 * They are not broken rows, they are the answer — so what matters is that the
 * screens render them as numbers a shopkeeper can read rather than as a bar
 * pointing the wrong way or a loss printed in green.
 */
describe("angka bersih yang negatif", () => {
  it("Jenis Pembayaran: baris tanpa transaksi dan bernilai negatif tetap tampil", async () => {
    installApiMock({
      ...REPORT_ROUTES,
      "GET /reports/payment-methods": [
        { paymentMethod: "cash", transactionCount: 3, totalAmount: 150000, percentage: 125 },
        { paymentMethod: "qris", transactionCount: 0, totalAmount: -30000, percentage: -25 },
      ],
    })

    renderWithQuery(<PaymentMethodsPage />)

    // The figure appears in the card above the table as well as in the row, so
    // finding it at all is the proof the negative amount rendered.
    expect(await screen.findAllByText(rupiahText(-30000))).not.toHaveLength(0)
    expect(await screen.findByText("-25.0%")).toBeInTheDocument()
    // The bar is decorative and the percentage is written out beside it; a
    // negative width is an invalid CSS declaration the browser drops silently,
    // so it is clamped rather than passed through.
    const bars = document.querySelectorAll<HTMLElement>("[style*='width']")
    for (const bar of bars) {
      const width = Number.parseFloat(bar.style.width)
      expect(width).toBeGreaterThanOrEqual(0)
      expect(width).toBeLessThanOrEqual(100)
    }
  })

  it("Penjualan Produk: laba negatif ditandai merah, bukan hijau", async () => {
    installApiMock({
      ...REPORT_ROUTES,
      "GET /reports/products/sales": [
        {
          productId: 1,
          productName: "Gula Pasir",
          barcode: "8991234567890",
          categoryName: "Bahan Pokok",
          qtySold: -2,
          totalRevenue: -30000,
          totalCost: -24000,
          profit: -6000,
        },
      ],
    })

    renderWithQuery(<ProductSalesPage />)

    expect(await screen.findByText("-2")).toBeInTheDocument()
    expect(screen.getByText(rupiahText(-6000))).toHaveClass("text-danger")
  })
})

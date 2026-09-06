import type { ComponentType } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Table } from "@heroui/react"

import { installApiMock, type ApiRoutes } from "@/test-utils/api-mock"

import { ReportPage, ReportStatCard, ReportTable } from "./components/report-shell"
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
  it("menampilkan judul dan kontrol filter", () => {
    render(
      <ReportPage title="Laporan Uji" filters={<button type="button">Filter</button>}>
        <p>Isi</p>
      </ReportPage>
    )

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Laporan Uji")
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument()
  })

  it("menulis label kartu ringkasan sebagai teks biasa, bukan heading", () => {
    render(
      <ReportPage title="Laporan Uji">
        <ReportStatCard label="Laba Kotor" tone="success" value="Rp 50.000" />
      </ReportPage>
    )

    expect(screen.getByText("Laba Kotor")).toBeInTheDocument()
    expect(screen.getByText("Rp 50.000")).toHaveClass("text-success")
    // Satu-satunya heading tetap judul halaman: `Card.Title` HeroUI merender `h3`
    // dan akan melompati tingkat heading, jadi labelnya sengaja bukan heading.
    expect(screen.getAllByRole("heading")).toHaveLength(1)
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
      </ReportTable>
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
      </ReportTable>
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
    }
  )
})

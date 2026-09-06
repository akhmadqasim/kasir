// --- Report Types ---

export interface DateRangeFilter {
  startDate: string // YYYY-MM-DD
  endDate: string   // YYYY-MM-DD
}

// Penjualan per Hari
export interface DailySalesRow {
  date: string
  transactionCount: number
  totalRevenue: number
  totalCost: number
  grossProfit: number
}

// Penjualan per Bulan
export interface MonthlySalesRow {
  month: string // YYYY-MM
  transactionCount: number
  totalRevenue: number
  totalCost: number
  grossProfit: number
}

// Penjualan per Periode (summary)
export interface PeriodSalesSummary {
  totalTransactions: number
  totalRevenue: number
  totalCost: number
  grossProfit: number
  avgPerTransaction: number
  dailyBreakdown: DailySalesRow[]
}

// Penjualan per Struk
export interface ReceiptRow {
  id: number
  receiptNumber: string
  cashierName: string
  /** What was rung up. Unchanged by a later return. */
  totalAmount: number
  paymentMethod: string
  status: string
  itemCount: number
  createdAt: string
  /** How much of this receipt has since been returned. `0` for most rows. */
  refundAmount: number
  /**
   * `totalAmount - refundAmount`: what the shop actually kept.
   *
   * The list now includes receipts whose status is `refunded`, because hiding
   * them while also subtracting their value elsewhere counted the money as lost
   * twice. Anything that sums a column has to sum this one.
   */
  netAmount: number
}

/** `items` dibatasi di backend; `totalCount` adalah jumlah baris yang cocok,
 *  jadi `items.length < totalCount` berarti daftarnya terpotong. */
export interface ReceiptReport {
  items: ReceiptRow[]
  totalCount: number
}

// Jenis Pembayaran
export interface PaymentMethodRow {
  paymentMethod: string
  transactionCount: number
  totalAmount: number
  percentage: number
}

// Penjualan Produk
export interface ProductSalesRow {
  productId: number
  productName: string
  barcode: string | null
  categoryName: string | null
  qtySold: number
  totalRevenue: number
  totalCost: number
  profit: number
}

// Produk Populer
export interface PopularProductRow {
  rank: number
  productId: number
  productName: string
  categoryName: string | null
  qtySold: number
  totalRevenue: number
}

// Retur Produk
export interface ReturnRow {
  id: number
  refundNumber: string
  transactionReceipt: string
  cashierName: string
  type: string
  totalRefundAmount: number
  reason: string | null
  createdAt: string
}

// Stok Saat Ini
export interface CurrentStockRow {
  productId: number
  barcode: string | null
  productName: string
  categoryName: string | null
  stock: number
  minStock: number
  unit: string
  buyPrice: number
  sellPrice: number
  stockValue: number
}

/** Kontrak pemotongan sama seperti {@link ReceiptReport}. */
export interface CurrentStockReport {
  items: CurrentStockRow[]
  totalCount: number
}

// Laporan Kerugian
export interface LossRow {
  id: number
  writeoffNumber: string
  productName: string
  cashierName: string
  quantity: number
  reason: string
  lossValue: number
  notes: string | null
  status: string
  createdAt: string
}

export interface LossSummary {
  totalWriteoffs: number
  totalQuantity: number
  totalLossValue: number
  byReason: { reason: string; count: number; totalValue: number }[]
  items: LossRow[]
}

export interface CashFlowReportRow {
  id: number
  shiftId: number
  cashierName: string
  flowType: string
  amount: number
  description: string
  createdAt: string
}

export interface CashFlowReportSummary {
  totalIn: number
  totalOut: number
  netTotal: number
  items: CashFlowReportRow[]
}

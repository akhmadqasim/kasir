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
  totalAmount: number
  paymentMethod: string
  status: string
  itemCount: number
  createdAt: string
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

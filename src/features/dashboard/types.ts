export interface DashboardSummary {
  todayRevenue: number
  todayTransactions: number
  todayRefunds: number
  todayRefundAmount: number
  yesterdayRevenue: number
  totalProducts: number
  lowStockCount: number
  todayGrossProfit: number
  todayAvgPerTransaction: number
}

export interface WeeklyStats {
  totalRevenue: number
  grossProfit: number
  totalTransactions: number
  avgItemsPerTransaction: number
  avgValuePerTransaction: number
}

export interface DailyRevenue {
  date: string
  revenue: number
  transactions: number
}

export interface PaymentMethodStat {
  method: string
  count: number
  total: number
}

export interface TopProduct {
  productId: number
  productName: string
  totalQty: number
  totalRevenue: number
}

export interface LowStockProduct {
  id: number
  name: string
  stock: number
  minStock: number
  unit: string
}

export interface RecentTransaction {
  id: number
  receiptNumber: string
  totalAmount: number
  paymentMethod: string
  status: string
  cashierName: string
  createdAt: string
}

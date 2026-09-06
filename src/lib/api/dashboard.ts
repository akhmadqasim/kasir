import type {
  DailyRevenue,
  DashboardSummary,
  LowStockProduct,
  PaymentMethodDaily,
  PaymentMethodStat,
  RecentTransaction,
  TopProduct,
} from "@/features/dashboard/types"
import { apiGet } from "./client"

export function getDashboardSummary(): Promise<DashboardSummary> {
  return apiGet<DashboardSummary>("/dashboard/summary")
}

export function getDailyRevenue(days: number): Promise<DailyRevenue[]> {
  return apiGet<DailyRevenue[]>("/dashboard/revenue/daily", { days })
}

export function getPaymentMethodStats(): Promise<PaymentMethodStat[]> {
  return apiGet<PaymentMethodStat[]>("/dashboard/payment-methods")
}

export function getPaymentMethodDaily(days: number): Promise<PaymentMethodDaily[]> {
  return apiGet<PaymentMethodDaily[]>("/dashboard/payment-methods/daily", { days })
}

export function getTopProducts(limit: number): Promise<TopProduct[]> {
  return apiGet<TopProduct[]>("/dashboard/products/top", { limit })
}

export function getLowStockProducts(): Promise<LowStockProduct[]> {
  return apiGet<LowStockProduct[]>("/dashboard/products/low-stock")
}

export function getRecentTransactions(): Promise<RecentTransaction[]> {
  return apiGet<RecentTransaction[]>("/dashboard/transactions/recent")
}

import { useApiQuery } from "@/hooks/use-api"
import {
  getDailyRevenue,
  getDashboardSummary,
  getLowStockProducts,
  getPaymentMethodStats,
  getRecentTransactions,
  getTopProducts,
} from "@/lib/api/dashboard"
import { queryKeys } from "@/lib/api/query-keys"
import type {
  DashboardSummary,
  DailyRevenue,
  PaymentMethodStat,
  TopProduct,
  LowStockProduct,
  RecentTransaction,
} from "../types"

export function useDashboardSummary() {
  return useApiQuery<DashboardSummary>(queryKeys.dashboard.summary, getDashboardSummary, {
    refetchInterval: 30000,
  })
}

export function useDailyRevenue(days: number = 7) {
  return useApiQuery<DailyRevenue[]>(queryKeys.dashboard.dailyRevenue(days), () =>
    getDailyRevenue(days),
  )
}

export function usePaymentMethodStats() {
  return useApiQuery<PaymentMethodStat[]>(
    queryKeys.dashboard.paymentMethods,
    getPaymentMethodStats,
    { refetchInterval: 30000 },
  )
}

export function useTopProducts(limit: number = 10) {
  return useApiQuery<TopProduct[]>(queryKeys.dashboard.topProducts(limit), () =>
    getTopProducts(limit),
  )
}

export function useLowStockProducts() {
  return useApiQuery<LowStockProduct[]>(queryKeys.dashboard.lowStock, getLowStockProducts)
}

export function useRecentTransactions() {
  return useApiQuery<RecentTransaction[]>(
    queryKeys.dashboard.recentTransactions,
    getRecentTransactions,
    { refetchInterval: 15000 },
  )
}

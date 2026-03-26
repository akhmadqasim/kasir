import { useTauriQuery } from "@/hooks/use-tauri-command"
import type {
  DashboardSummary,
  DailyRevenue,
  PaymentMethodStat,
  TopProduct,
  LowStockProduct,
  RecentTransaction,
  WeeklyStats,
} from "../types"

export function useDashboardSummary() {
  return useTauriQuery<DashboardSummary>("get_dashboard_summary", undefined, {
    refetchInterval: 30000,
  })
}

export function useDailyRevenue(days: number = 7) {
  return useTauriQuery<DailyRevenue[]>("get_daily_revenue", { days })
}

export function usePaymentMethodStats() {
  return useTauriQuery<PaymentMethodStat[]>("get_payment_method_stats", undefined, {
    refetchInterval: 30000,
  })
}

export function useTopProducts(limit: number = 10) {
  return useTauriQuery<TopProduct[]>("get_top_products", { limit })
}

export function useLowStockProducts() {
  return useTauriQuery<LowStockProduct[]>("get_low_stock_products")
}

export function useRecentTransactions() {
  return useTauriQuery<RecentTransaction[]>("get_recent_transactions", undefined, {
    refetchInterval: 15000,
  })
}

export function useWeeklyStats() {
  return useTauriQuery<WeeklyStats>("get_weekly_stats", undefined, {
    refetchInterval: 30000,
  })
}

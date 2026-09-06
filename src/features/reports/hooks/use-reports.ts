import { useApiQuery } from "@/hooks/use-api"
import * as reportsApi from "@/lib/api/reports"
import { queryKeys } from "@/lib/api/query-keys"
import type {
  DailySalesRow,
  MonthlySalesRow,
  PeriodSalesSummary,
  ReceiptReport,
  PaymentMethodRow,
  ProductSalesRow,
  PopularProductRow,
  ReturnRow,
  CurrentStockReport,
  LossSummary,
  CashFlowReportSummary,
} from "../types"

/**
 * The eleven report screens.
 *
 * These were the last eleven raw `useQuery` + `invoke` pairs in the codebase,
 * each spelling out its own key by hand. They go through the same two hooks as
 * everything else now, with keys from the shared factory — which matters less
 * for invalidation here (nothing invalidates a report) than for consistency:
 * one place to look when a key is wrong.
 */

export function useSalesDaily(startDate: string, endDate: string) {
  const range = { startDate, endDate }
  return useApiQuery<DailySalesRow[]>(queryKeys.reports.salesDaily(range), () =>
    reportsApi.reportSalesDaily(range)
  )
}

export function useSalesMonthly(year: number) {
  return useApiQuery<MonthlySalesRow[]>(queryKeys.reports.salesMonthly(year), () =>
    reportsApi.reportSalesMonthly(year)
  )
}

export function useSalesPeriod(startDate: string, endDate: string) {
  const range = { startDate, endDate }
  return useApiQuery<PeriodSalesSummary>(queryKeys.reports.salesPeriod(range), () =>
    reportsApi.reportSalesPeriod(range)
  )
}

export function useSalesReceipt(startDate: string, endDate: string, search: string) {
  const range = { startDate, endDate }
  return useApiQuery<ReceiptReport>(queryKeys.reports.salesReceipt(range, search), () =>
    reportsApi.reportSalesReceipts(range, search)
  )
}

export function usePaymentMethods(startDate: string, endDate: string) {
  const range = { startDate, endDate }
  return useApiQuery<PaymentMethodRow[]>(queryKeys.reports.paymentMethods(range), () =>
    reportsApi.reportPaymentMethods(range)
  )
}

export function useProductSales(startDate: string, endDate: string) {
  const range = { startDate, endDate }
  return useApiQuery<ProductSalesRow[]>(queryKeys.reports.productSales(range), () =>
    reportsApi.reportProductSales(range)
  )
}

export function usePopularProducts(startDate: string, endDate: string, limit: number) {
  const range = { startDate, endDate }
  return useApiQuery<PopularProductRow[]>(
    queryKeys.reports.popularProducts(range, limit),
    () => reportsApi.reportPopularProducts(range, limit)
  )
}

export function useReturns(startDate: string, endDate: string) {
  const range = { startDate, endDate }
  return useApiQuery<ReturnRow[]>(queryKeys.reports.returns(range), () =>
    reportsApi.reportReturns(range)
  )
}

export function useCurrentStock(search: string, filter: "all" | "low") {
  return useApiQuery<CurrentStockReport>(
    queryKeys.reports.currentStock(search, filter),
    () => reportsApi.reportCurrentStock(search, filter)
  )
}

export function useLosses(startDate: string, endDate: string) {
  const range = { startDate, endDate }
  return useApiQuery<LossSummary>(queryKeys.reports.losses(range), () =>
    reportsApi.reportLosses(range)
  )
}

export function useCashFlows(startDate: string, endDate: string) {
  const range = { startDate, endDate }
  return useApiQuery<CashFlowReportSummary>(queryKeys.reports.cashFlows(range), () =>
    reportsApi.reportCashFlows(range)
  )
}

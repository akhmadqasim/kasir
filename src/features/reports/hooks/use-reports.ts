import { useQuery } from "@tanstack/react-query"
import { invoke } from "@tauri-apps/api/core"
import type {
  DailySalesRow,
  MonthlySalesRow,
  PeriodSalesSummary,
  ReceiptRow,
  PaymentMethodRow,
  ProductSalesRow,
  PopularProductRow,
  ReturnRow,
  CurrentStockRow,
  LossSummary,
} from "../types"

export function useSalesDaily(startDate: string, endDate: string) {
  return useQuery<DailySalesRow[]>({
    queryKey: ["reports", "sales-daily", startDate, endDate],
    queryFn: () => invoke("report_sales_daily", { startDate, endDate }),
  })
}

export function useSalesMonthly(year: number) {
  return useQuery<MonthlySalesRow[]>({
    queryKey: ["reports", "sales-monthly", year],
    queryFn: () => invoke("report_sales_monthly", { year }),
  })
}

export function useSalesPeriod(startDate: string, endDate: string) {
  return useQuery<PeriodSalesSummary>({
    queryKey: ["reports", "sales-period", startDate, endDate],
    queryFn: () => invoke("report_sales_period", { startDate, endDate }),
  })
}

export function useSalesReceipt(startDate: string, endDate: string, search: string) {
  return useQuery<ReceiptRow[]>({
    queryKey: ["reports", "sales-receipt", startDate, endDate, search],
    queryFn: () => invoke("report_sales_receipt", { startDate, endDate, search }),
  })
}

export function usePaymentMethods(startDate: string, endDate: string) {
  return useQuery<PaymentMethodRow[]>({
    queryKey: ["reports", "payment-methods", startDate, endDate],
    queryFn: () => invoke("report_payment_methods", { startDate, endDate }),
  })
}

export function useProductSales(startDate: string, endDate: string) {
  return useQuery<ProductSalesRow[]>({
    queryKey: ["reports", "product-sales", startDate, endDate],
    queryFn: () => invoke("report_product_sales", { startDate, endDate }),
  })
}

export function usePopularProducts(startDate: string, endDate: string, limit: number) {
  return useQuery<PopularProductRow[]>({
    queryKey: ["reports", "popular-products", startDate, endDate, limit],
    queryFn: () => invoke("report_popular_products", { startDate, endDate, limit }),
  })
}

export function useReturns(startDate: string, endDate: string) {
  return useQuery<ReturnRow[]>({
    queryKey: ["reports", "returns", startDate, endDate],
    queryFn: () => invoke("report_returns", { startDate, endDate }),
  })
}

export function useCurrentStock(search: string, filter: "all" | "low") {
  return useQuery<CurrentStockRow[]>({
    queryKey: ["reports", "current-stock", search, filter],
    queryFn: () => invoke("report_current_stock", { search, filter }),
  })
}

export function useLosses(startDate: string, endDate: string) {
  return useQuery<LossSummary>({
    queryKey: ["reports", "losses", startDate, endDate],
    queryFn: () => invoke("report_losses", { startDate, endDate }),
  })
}

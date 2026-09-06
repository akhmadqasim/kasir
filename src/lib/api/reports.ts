import type {
  CashFlowReportSummary,
  CurrentStockReport,
  DailySalesRow,
  LossSummary,
  MonthlySalesRow,
  PaymentMethodRow,
  PeriodSalesSummary,
  PopularProductRow,
  ProductSalesRow,
  ReceiptReport,
  ReturnRow,
} from "@/features/reports/types"
import { apiGet } from "./client"

/**
 * The eleven reports.
 *
 * The date window is `start_date`/`end_date` — snake_case, because the Rust
 * `DateRange` these routes share has no `rename_all`. Both halves are local
 * `YYYY-MM-DD` dates; the server turns them into UTC boundaries itself.
 *
 * Every figure here is net of refunds, and a return is subtracted on the day it
 * was taken rather than the day of the sale. That means a payment-method row can
 * arrive with a count of zero and a negative amount, and a product row with a
 * quantity of zero or below, for a period that saw only returns. Those are not
 * broken rows — they are the shape of the answer.
 */

interface DateRange {
  startDate: string
  endDate: string
}

function rangeQuery({ startDate, endDate }: DateRange) {
  return { start_date: startDate, end_date: endDate }
}

export function reportSalesDaily(range: DateRange): Promise<DailySalesRow[]> {
  return apiGet<DailySalesRow[]>("/reports/sales/daily", rangeQuery(range))
}

export function reportSalesMonthly(year: number): Promise<MonthlySalesRow[]> {
  return apiGet<MonthlySalesRow[]>("/reports/sales/monthly", { year })
}

export function reportSalesPeriod(range: DateRange): Promise<PeriodSalesSummary> {
  return apiGet<PeriodSalesSummary>("/reports/sales/period", rangeQuery(range))
}

/**
 * The receipt list now includes receipts whose status is `refunded`. A screen
 * that totals a column has to total `netAmount`, not `totalAmount`, or the
 * returned money is counted as if it were still in the till.
 */
export function reportSalesReceipts(
  range: DateRange,
  search: string
): Promise<ReceiptReport> {
  return apiGet<ReceiptReport>("/reports/sales/receipts", {
    ...rangeQuery(range),
    search,
  })
}

export function reportPaymentMethods(range: DateRange): Promise<PaymentMethodRow[]> {
  return apiGet<PaymentMethodRow[]>("/reports/payment-methods", rangeQuery(range))
}

export function reportProductSales(range: DateRange): Promise<ProductSalesRow[]> {
  return apiGet<ProductSalesRow[]>("/reports/products/sales", rangeQuery(range))
}

export function reportPopularProducts(
  range: DateRange,
  limit: number
): Promise<PopularProductRow[]> {
  return apiGet<PopularProductRow[]>("/reports/products/popular", {
    ...rangeQuery(range),
    limit,
  })
}

export function reportReturns(range: DateRange): Promise<ReturnRow[]> {
  return apiGet<ReturnRow[]>("/reports/returns", rangeQuery(range))
}

export function reportCurrentStock(
  search: string,
  filter: string
): Promise<CurrentStockReport> {
  return apiGet<CurrentStockReport>("/reports/stock/current", { search, filter })
}

export function reportLosses(range: DateRange): Promise<LossSummary> {
  return apiGet<LossSummary>("/reports/losses", rangeQuery(range))
}

export function reportCashFlows(range: DateRange): Promise<CashFlowReportSummary> {
  return apiGet<CashFlowReportSummary>("/reports/cash-flows", rangeQuery(range))
}

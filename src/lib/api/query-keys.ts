/**
 * Every React Query key in the application, in one table.
 *
 * ## Why this file exists
 *
 * The keys used to be the Tauri command name: a query was cached under
 * `["search_products", args]` and the code that had just saved a product wrote
 * `invalidateQueries({ queryKey: ["search_products"] })`. The two matched
 * because both were the same string, and a typo would have been caught by
 * nothing at all — an invalidation that matches no query is not an error in
 * React Query, it is a no-op. The screen simply does not refresh, and it does
 * not refresh *silently*.
 *
 * Moving to URLs removed the string that used to hold the two ends together, so
 * they are held together here instead. A query and the invalidation that must
 * hit it now come from the same factory, and a key that no longer exists is a
 * compile error rather than a stale screen.
 *
 * ## The shape
 *
 * Keys are hierarchical, from the widest to the narrowest:
 *
 * ```
 * ["products"]                       ← everything about products
 * ["products", "search"]             ← every search, whatever the filters
 * ["products", "search", { page: 2 }]← one search
 * ```
 *
 * React Query matches invalidations by prefix, so `all` invalidates every query
 * under a resource and the narrower roots exist for the cases where that is too
 * much. `track_product_selection` fires on every scan; invalidating all of
 * `["products"]` there would refetch the search list on every item added to the
 * cart, so the pin/selection paths use `popularAll` instead.
 */

import type { ListWriteoffsParams } from "@/features/stock/types"
import type { SearchProductsParams } from "@/features/products/types"
import type { ListTransactionsInput } from "@/features/transactions/types"
import type { ListRefundsInput } from "@/features/refunds/types"

/** A date window shared by nine of the eleven reports. */
export interface ReportRange {
  startDate: string
  endDate: string
}

export const queryKeys = {
  auth: {
    all: ["auth"] as const,
    me: ["auth", "me"] as const,
  },

  onboarding: {
    all: ["onboarding"] as const,
    status: ["onboarding", "status"] as const,
  },

  users: {
    all: ["users"] as const,
    list: ["users", "list"] as const,
  },

  products: {
    all: ["products"] as const,
    searchAll: ["products", "search"] as const,
    search: (params: SearchProductsParams) => ["products", "search", params] as const,
    popularAll: ["products", "popular"] as const,
    popular: (limit: number) => ["products", "popular", limit] as const,
  },

  categories: {
    all: ["categories"] as const,
    list: ["categories", "list"] as const,
  },

  transactions: {
    all: ["transactions"] as const,
    listAll: ["transactions", "list"] as const,
    list: (params: ListTransactionsInput) => ["transactions", "list", params] as const,
    detail: (transactionId: number) => ["transactions", "detail", transactionId] as const,
    receipt: (transactionId: number) => ["transactions", "receipt", transactionId] as const,
    nextReceiptNumber: ["transactions", "next-receipt-number"] as const,
  },

  refunds: {
    all: ["refunds"] as const,
    listAll: ["refunds", "list"] as const,
    list: (params: ListRefundsInput) => ["refunds", "list", params] as const,
    detail: (refundId: number) => ["refunds", "detail", refundId] as const,
  },

  stock: {
    all: ["stock"] as const,
    writeoffsAll: ["stock", "writeoffs"] as const,
    writeoffs: (params: ListWriteoffsParams) => ["stock", "writeoffs", params] as const,
  },

  shifts: {
    all: ["shifts"] as const,
    active: ["shifts", "active"] as const,
    summary: (shiftId: number) => ["shifts", "summary", shiftId] as const,
    cashFlows: (shiftId: number) => ["shifts", "cash-flows", shiftId] as const,
  },

  reports: {
    all: ["reports"] as const,
    salesDaily: (range: ReportRange) => ["reports", "sales-daily", range] as const,
    salesMonthly: (year: number) => ["reports", "sales-monthly", year] as const,
    salesPeriod: (range: ReportRange) => ["reports", "sales-period", range] as const,
    salesReceipt: (range: ReportRange, search: string) =>
      ["reports", "sales-receipt", range, search] as const,
    paymentMethods: (range: ReportRange) => ["reports", "payment-methods", range] as const,
    productSales: (range: ReportRange) => ["reports", "product-sales", range] as const,
    popularProducts: (range: ReportRange, limit: number) =>
      ["reports", "popular-products", range, limit] as const,
    returns: (range: ReportRange) => ["reports", "returns", range] as const,
    currentStock: (search: string, filter: string) =>
      ["reports", "current-stock", search, filter] as const,
    losses: (range: ReportRange) => ["reports", "losses", range] as const,
    cashFlows: (range: ReportRange) => ["reports", "cash-flows", range] as const,
  },

  dashboard: {
    all: ["dashboard"] as const,
    summary: ["dashboard", "summary"] as const,
    dailyRevenue: (days: number) => ["dashboard", "daily-revenue", days] as const,
    paymentMethods: ["dashboard", "payment-methods"] as const,
    paymentMethodsDaily: (days: number) => ["dashboard", "payment-methods", "daily", days] as const,
    topProducts: (limit: number) => ["dashboard", "top-products", limit] as const,
    lowStock: ["dashboard", "low-stock"] as const,
    recentTransactions: ["dashboard", "recent-transactions"] as const,
  },

  settings: {
    all: ["settings"] as const,
    store: ["settings", "store"] as const,
    app: ["settings", "app"] as const,
    database: ["settings", "database"] as const,
  },

  backups: {
    all: ["backups"] as const,
    list: ["backups", "list"] as const,
    status: ["backups", "status"] as const,
  },

  updates: {
    all: ["updates"] as const,
    status: ["updates", "status"] as const,
  },

  printers: {
    all: ["printers"] as const,
    list: ["printers", "list"] as const,
    settings: ["printers", "settings"] as const,
  },

  ppob: {
    all: ["ppob"] as const,
    balance: ["ppob", "balance"] as const,
    menu: ["ppob", "menu"] as const,
    catalogAll: ["ppob", "catalog"] as const,
    providers: ["ppob", "catalog", "providers"] as const,
    pulsaDetails: (phoneNumber: string) =>
      ["ppob", "catalog", "pulsa-details", phoneNumber] as const,
    pulsaPrices: (providerUid: string) => ["ppob", "catalog", "pulsa-prices", providerUid] as const,
    dataPrices: (providerUid: string) => ["ppob", "catalog", "data-prices", providerUid] as const,
    plnDenominations: ["ppob", "catalog", "pln-denominations"] as const,
    pdamProducts: ["ppob", "catalog", "pdam-products"] as const,
    emoneyDenominations: (productId: number) =>
      ["ppob", "catalog", "emoney-denominations", productId] as const,
    paymentPointSubMenu: (paymentPointId: number) =>
      ["ppob", "catalog", "payment-point-sub-menu", paymentPointId] as const,
    transferChannels: ["ppob", "catalog", "transfer-channels"] as const,
    voucherGroups: ["ppob", "catalog", "voucher-groups"] as const,
    history: (range: ReportRange) => ["ppob", "history", range] as const,
    historyDetail: (trxId: string) => ["ppob", "history", "detail", trxId] as const,
    mutasi: (range: ReportRange) => ["ppob", "mutasi", range] as const,
    notificationsAll: ["ppob", "notifications"] as const,
    notifications: (page: number, perPage: number, forceRefresh: boolean) =>
      ["ppob", "notifications", { page, perPage, forceRefresh }] as const,
  },
} as const

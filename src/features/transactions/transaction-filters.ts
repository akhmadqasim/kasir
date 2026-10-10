import { getTodayRange, type DateRange } from "@/lib/date-range"
import { toLocalDateString } from "@/lib/format"
import { id } from "@/i18n/id"
import type { ListTransactionsInput } from "./types"

/** Nilai sentinel `Select`: React Aria memakai `null` untuk "tidak ada pilihan". */
export const ALL = "all"

/**
 * Sumber transaksi yang ditampilkan. Bawaannya `sales`: tagihan yang dibayar
 * dari halaman PPOB memang transaksi juga, tapi bukan penjualan barang, jadi
 * ia tidak ikut riwayat ini kecuali kasir sengaja beralih.
 */
export type ChannelFilter = "sales" | "ppob" | typeof ALL

export const CHANNEL_FILTERS: { key: ChannelFilter; label: string }[] = [
  { key: "sales", label: id.transactions.channelSales },
  { key: "ppob", label: id.transactions.channelPpob },
  { key: ALL, label: id.transactions.channelAll },
]

export const PAYMENT_METHOD_FILTERS = [
  { key: ALL, label: id.transactions.allMethods },
  { key: "cash", label: id.payment.cash },
  { key: "qris", label: id.payment.qris },
  { key: "debit", label: id.payment.debit },
  { key: "ewallet", label: id.payment.ewallet },
  { key: "transfer", label: id.payment.transfer },
  { key: "mixed", label: id.payment.mixed },
] as const

/**
 * Status filters that match the sale's PPOB *lines* (`services/transactions/
 * queries.rs`), not `transactions.status` — checkout leaves the sale
 * `completed` while its lines move. "Perlu dicek" lists the `uncertain` ones.
 */
export const PPOB_UNCERTAIN_FILTER = "ppob_uncertain"
const PPOB_LINE_FILTERS: readonly string[] = ["pending_ppob", "ppob_failed", PPOB_UNCERTAIN_FILTER]

export const STATUS_FILTERS = [
  { key: ALL, label: id.transactions.allStatus },
  { key: "completed", label: id.transactions.completed },
  { key: "pending_ppob", label: id.transactions.pendingPpob },
  { key: "ppob_failed", label: id.transactions.ppobFailed },
  { key: PPOB_UNCERTAIN_FILTER, label: id.transactions.ppobUncertain },
  { key: "refunded", label: id.transactions.refunded },
  { key: "partial_refund", label: id.transactions.partialRefund },
  { key: "deleted", label: id.transactions.deleted },
] as const

/** What the history is filtered by. An empty string means "any". */
export interface TransactionFilters {
  search: string
  paymentMethod: string
  status: string
  channel: ChannelFilter
  dateRange: DateRange | undefined
}

/** Today's sales, any method and status — also what "Reset filter" goes back to. */
export function defaultTransactionFilters(): TransactionFilters {
  return { search: "", paymentMethod: "", status: "", channel: "sales", dateRange: getTodayRange() }
}

/** Whether anything differs from {@link defaultTransactionFilters}. */
export function hasActiveFilters(filters: TransactionFilters): boolean {
  const today = toLocalDateString(new Date())
  const { from, to } = filters.dateRange ?? {}
  return (
    filters.channel !== "sales" ||
    filters.search !== "" ||
    filters.paymentMethod !== "" ||
    filters.status !== "" ||
    (!!from && toLocalDateString(from) !== today) ||
    (!!to && toLocalDateString(to) !== today)
  )
}

/** The list request for one page; `search` is passed separately because it is debounced. */
export function transactionListParams(
  filters: TransactionFilters,
  search: string,
  page: number,
): ListTransactionsInput {
  const { from, to } = filters.dateRange ?? {}
  return {
    page,
    per_page: 50,
    search: search || undefined,
    payment_method: filters.paymentMethod || undefined,
    status: filters.status || undefined,
    channel: filters.channel === ALL ? undefined : filters.channel,
    date_from: from ? toLocalDateString(from) : undefined,
    date_to: to ? toLocalDateString(to) : undefined,
  }
}

/**
 * The patch for picking a status. A PPOB line filter also drops the date range
 * and the channel: a line can wait days for the biller, on the PPOB page or in
 * a cart, and "today's sales" would hide exactly the old ones that need a person.
 * The cashier can narrow the dates again afterwards.
 */
export function statusFilterPatch(status: string): Partial<TransactionFilters> {
  if (PPOB_LINE_FILTERS.includes(status)) {
    return { status, channel: ALL, dateRange: undefined }
  }
  return { status }
}

/** "Perlu dicek" across every day and channel — where the indicator leads. */
export function ppobAttentionFilters(): TransactionFilters {
  return { ...defaultTransactionFilters(), ...statusFilterPatch(PPOB_UNCERTAIN_FILTER) }
}

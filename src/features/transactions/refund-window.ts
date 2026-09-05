import { parseBackendDate } from "@/lib/format"

/**
 * The refund window, mirroring `create_refund_internal` in
 * `src-tauri/src/commands/refunds.rs`.
 *
 * Two details of the backend rule matter here and are easy to get wrong:
 *
 * 1. It compares **durations**, not whole days. `num_days()` truncated toward
 *    zero, so `days > 7` stayed false until 7d23h59m and the "7 day" rule really
 *    ran for almost eight. The check is now `age > Duration::days(7)` — an exact
 *    168 hours from the moment of sale.
 * 2. A transaction with no `created_at` is **not** refundable. The old code
 *    skipped the check for those rows, which made a missing timestamp mean
 *    "unlimited"; it now rejects them outright.
 */
export const REFUND_MAX_DAYS = 7
export const REFUND_WINDOW_MS = REFUND_MAX_DAYS * 24 * 60 * 60 * 1000

export type RefundWindowState = "open" | "expired" | "unknown"

export function refundWindowState(
  createdAt: string | null | undefined,
  now: Date = new Date()
): RefundWindowState {
  const soldAt = parseBackendDate(createdAt)
  if (!soldAt) return "unknown"

  const age = now.getTime() - soldAt.getTime()
  return age > REFUND_WINDOW_MS ? "expired" : "open"
}

export function isWithinRefundWindow(
  createdAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  return refundWindowState(createdAt, now) === "open"
}

/** Why the refund button is disabled, or `null` when it is not. */
export function refundBlockedReason(
  createdAt: string | null | undefined,
  now: Date = new Date()
): string | null {
  switch (refundWindowState(createdAt, now)) {
    case "expired":
      return `Lewat batas ${REFUND_MAX_DAYS} hari setelah pembelian, refund tidak bisa diproses`
    case "unknown":
      return "Transaksi tanpa tanggal tidak bisa di-refund"
    default:
      return null
  }
}

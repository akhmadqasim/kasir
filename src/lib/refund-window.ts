import { id } from "@/i18n/id"

import { MAX_REFUND_DAYS } from "@/lib/constants"
import { parseBackendDate } from "@/lib/format"

/**
 * The refund window, mirroring `src-tauri/src/services/refunds/create/eligibility.rs`:
 * exactly 168 hours from the sale, and a sale with no `created_at` is not
 * refundable. A failed PPOB top-up still owed has no window.
 */
export const REFUND_MAX_DAYS = MAX_REFUND_DAYS
const REFUND_WINDOW_MS = REFUND_MAX_DAYS * 24 * 60 * 60 * 1000

export type RefundWindowState = "open" | "expired" | "unknown"

export function refundWindowState(
  createdAt: string | null | undefined,
  now: Date = new Date(),
): RefundWindowState {
  const soldAt = parseBackendDate(createdAt)
  if (!soldAt) return "unknown"

  const age = now.getTime() - soldAt.getTime()
  return age > REFUND_WINDOW_MS ? "expired" : "open"
}

/**
 * Why the refund button is disabled by the window, or `null` when it is not.
 * Callers that know about failed top-ups use `refundActionBlockedReason`.
 */
export function refundBlockedReason(
  createdAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  switch (refundWindowState(createdAt, now)) {
    case "expired":
      return id.refund.windowExpired(REFUND_MAX_DAYS)
    case "unknown":
      return id.refund.windowUnknown
    default:
      return null
  }
}

/** What the refund page will do with the returned lines. */
export type RefundAction = "refund" | "exchange"

interface RefundActionWindow {
  /** The sale still owes a failed PPOB top-up (`has_refundable_failed_ppob`). */
  hasRefundableFailedPpob: boolean
  action: RefundAction
}

/**
 * Why `action` is blocked by the window for this sale, or `null` when it is not.
 *
 * Mirrors `check_refund_window`: only a pure refund of a failed top-up still
 * owed skips the seven days. An exchange keeps the window even then, because
 * new goods go out.
 */
export function refundActionBlockedReason(
  createdAt: string | null | undefined,
  { hasRefundableFailedPpob, action }: RefundActionWindow,
  now: Date = new Date(),
): string | null {
  if (hasRefundableFailedPpob && action === "refund") return null
  const reason = refundBlockedReason(createdAt, now)
  // Here a refund of the failed top-up is still possible; say that only the
  // exchange is closed.
  if (reason && hasRefundableFailedPpob && refundWindowState(createdAt, now) === "expired") {
    return id.refund.exchangeWindowExpired(REFUND_MAX_DAYS)
  }
  return reason
}

/** The fields of a sold line that decide whether the window applies to it. */
interface RefundLineState {
  product_id: number | null
  refundable_quantity: number
}

/**
 * Whether the window still holds for this refundable line: always for a
 * top-up (refundable only once failed) with money left to give back, else
 * only while the sale is inside it.
 */
export function isLineInsideRefundWindow(
  line: RefundLineState,
  createdAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const owedTopUp = line.product_id === null && line.refundable_quantity > 0
  return owedTopUp || refundWindowState(createdAt, now) === "open"
}

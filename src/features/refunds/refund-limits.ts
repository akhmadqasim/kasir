import { id } from "@/i18n/id"

/**
 * How much of each sold line may still be returned.
 *
 * `GET /transactions/:id` reports `refunded_quantity` per line, summed from the
 * earlier refunds of the sale, so the form offers `quantity - refunded_quantity`
 * as the maximum from the start — the same remainder `create_refund` enforces.
 *
 * The rejection parser below stays as a second line of defence: another till can
 * refund the same sale between loading the form and submitting it, and then the
 * number in the server's error is fresher than the one the form loaded. Feeding
 * it back can only ever *lower* the offered maximum, never raise it, so a stale
 * or mis-attributed reading cannot produce an over-refund.
 */

/** A sold line's purchased units and the units earlier refunds took back. */
export interface RefundableLine {
  quantity: number
  refunded_quantity: number
}

/** Units of the line that may still be returned; never negative. */
export function remainingRefundableQuantity(line: RefundableLine): number {
  const refunded = Number.isFinite(line.refunded_quantity) ? line.refunded_quantity : 0
  return Math.max(line.quantity - Math.max(refunded, 0), 0)
}

/** Whether any line of the sale has already come back, even partly. */
export function hasRefundedLines(lines: readonly RefundableLine[]): boolean {
  return lines.some((line) => line.refunded_quantity > 0)
}

const REMAINING_QUANTITY_PATTERN = /melebihi sisa yang bisa di-refund \((\d+)\) untuk (.+)$/

export interface RemainingQuantityLimit {
  /** Units of this product that may still be returned. */
  remaining: number
  /** Product name as the backend spelled it, used to match the form line. */
  productName: string
}

export function parseRemainingQuantityError(
  message: string | null | undefined,
): RemainingQuantityLimit | null {
  if (!message) return null

  const match = REMAINING_QUANTITY_PATTERN.exec(message.trim())
  if (!match) return null

  const remaining = Number(match[1])
  const productName = match[2].trim()
  if (!Number.isFinite(remaining) || remaining < 0 || !productName) return null

  return { remaining, productName }
}

/** Message that tells the cashier what to do, not just that something failed. */
export function remainingQuantityMessage(limit: RemainingQuantityLimit): string {
  if (limit.remaining === 0) {
    return id.refund.nothingLeftToReturn(limit.productName)
  }
  return id.refund.remainingAdjusted(limit.productName, limit.remaining)
}

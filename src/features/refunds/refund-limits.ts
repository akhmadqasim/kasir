import { id } from "@/i18n/id"

/**
 * How much of each sold line may still be returned.
 *
 * `GET /transactions/:id` reports `refundable` and `refundable_quantity` per
 * line, so the server owns the refund rule and the form only reads it.
 *
 * The rejection parser below stays as a second line of defence: another till can
 * refund the same sale between loading the form and submitting it, and then the
 * number in the server's error is fresher than the one the form loaded. Feeding
 * it back can only ever *lower* the offered maximum, never raise it.
 */

/** Units of the line that may still be returned; never negative. */
export function remainingRefundableQuantity(line: { refundable_quantity: number }): number {
  return Number.isFinite(line.refundable_quantity) ? Math.max(line.refundable_quantity, 0) : 0
}

/** Whether a sold line can come back on a refund at all, as the server says. */
export function isRefundableLine(line: { refundable: boolean }): boolean {
  return line.refundable
}

/** A failed PPOB line: money only, refunded whole, no condition to pick. */
export function isPpobRefundLine(line: { product_id: number | null }): boolean {
  return line.product_id === null
}

/** Whether any line of the sale has already come back, even partly. */
export function hasRefundedLines(lines: readonly { refunded_quantity: number }[]): boolean {
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

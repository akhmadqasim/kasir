/**
 * Reading the remaining refundable quantity back out of a rejected refund.
 *
 * `create_refund` caps each line at `quantity - already_refunded`, but **nothing
 * the frontend can call exposes that remainder**: `get_transaction_detail` returns
 * raw `transaction_items` rows with no refund tally, `list_refunds` cannot be
 * filtered by transaction, and `get_refund_detail` needs a refund id the cashier
 * does not have. Until the backend adds a `refunded_quantity` (or
 * `refundable_quantity`) field to the transaction detail items, the only place the
 * number exists on this side is inside the validation error itself.
 *
 * So we parse it and feed it back into the form: the cashier gets the real cap on
 * the input instead of an error they can only guess their way out of. This can
 * only ever *lower* the offered maximum, never raise it, so a stale or
 * mis-attributed reading cannot produce an over-refund.
 */

const REMAINING_QUANTITY_PATTERN =
  /melebihi sisa yang bisa di-refund \((\d+)\) untuk (.+)$/

export interface RemainingQuantityLimit {
  /** Units of this product that may still be returned. */
  remaining: number
  /** Product name as the backend spelled it, used to match the form line. */
  productName: string
}

export function parseRemainingQuantityError(
  message: string | null | undefined
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
    return `${limit.productName} sudah diretur seluruhnya, tidak ada sisa yang bisa dikembalikan.`
  }
  return `Sisa ${limit.productName} yang bisa diretur tinggal ${limit.remaining}. Jumlahnya sudah disesuaikan.`
}

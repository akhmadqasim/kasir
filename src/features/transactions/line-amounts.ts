import type { TransactionItem } from "./types"

/** Just enough of a sold line to price it. */
export type PricedLine = Pick<
  TransactionItem,
  "quantity" | "subtotal" | "net_subtotal"
>

/**
 * Rupiah actually paid for a whole sold line.
 *
 * `product_price * quantity` is the list price and ignores both the line's own
 * discount and its share of the transaction discount, so a receipt built from it
 * never adds up to its own total. `net_subtotal` is the number the backend
 * persisted for exactly this purpose (migration 018).
 */
export function netLineAmount(item: PricedLine): number {
  return item.net_subtotal
}

/**
 * Rupiah paid for a single unit of a sold line — the unit price a refund pays
 * back. Mirrors `refund_amount_for` in `commands/refunds.rs`.
 */
export function netUnitAmount(item: PricedLine): number {
  if (item.quantity <= 0) return 0
  return item.net_subtotal / item.quantity
}

/** Rupiah to hand back for `quantity` units of a sold line. */
export function netAmountForQuantity(item: PricedLine, quantity: number): number {
  return netUnitAmount(item) * quantity
}

/**
 * Rupiah knocked off this line, list price minus what was paid. Covers the line's
 * own discount *and* its share of the transaction discount, so it can exceed
 * `item_discount`.
 */
export function lineDiscountAmount(item: PricedLine): number {
  return Math.max(item.subtotal - item.net_subtotal, 0)
}

/** Whether the line was sold below its list price and needs the crossed-out row. */
export function isDiscountedLine(item: PricedLine): boolean {
  return lineDiscountAmount(item) > 0.005
}

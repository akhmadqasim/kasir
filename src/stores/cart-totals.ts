import type { CartItem } from "@/features/cashier/types"

export interface DiscountEntry {
  type: "fixed" | "percentage"
  value: number
}

export interface CartTotals {
  subtotal: number
  itemDiscountsTotal: number
  transactionDiscountAmount: number
  totalDiscount: number
  total: number
}

/** A percentage is rounded to whole rupiah; a fixed amount never exceeds its base. */
export function discountAmount(base: number, discount: DiscountEntry): number {
  if (discount.type === "percentage") {
    return Math.round((base * discount.value) / 100)
  }
  return Math.min(discount.value, base)
}

/**
 * A discount as the cart stores it: a percentage at most 100, a fixed amount
 * at most `base` (never below 0), `null` when nothing is left of it. `capped`
 * tells whether the value had to be cut down to its limit.
 */
export function normalizeDiscount(
  discount: DiscountEntry | null,
  base: number,
): { entry: DiscountEntry | null; capped: boolean } {
  if (!discount) return { entry: null, capped: false }
  const cap = discount.type === "percentage" ? 100 : Math.max(base, 0)
  const value = Math.min(discount.value, cap)
  return {
    entry: value > 0 ? { type: discount.type, value } : null,
    capped: discount.value > cap,
  }
}

/**
 * Every total the cashier screen shows, in one pass. The transaction discount
 * applies to what is left after the per-line discounts, and the total never
 * goes below zero.
 */
export function computeCartTotals(
  items: CartItem[],
  itemDiscounts: Record<string, DiscountEntry>,
  transactionDiscount: DiscountEntry | null,
): CartTotals {
  let subtotal = 0
  let itemDiscountsTotal = 0
  for (const item of items) {
    const lineTotal = item.product_price * item.quantity
    subtotal += lineTotal
    const disc = itemDiscounts[item.cart_id]
    if (disc) itemDiscountsTotal += discountAmount(lineTotal, disc)
  }
  const transactionDiscountAmount = transactionDiscount
    ? discountAmount(subtotal - itemDiscountsTotal, transactionDiscount)
    : 0
  const totalDiscount = itemDiscountsTotal + transactionDiscountAmount
  return {
    subtotal,
    itemDiscountsTotal,
    transactionDiscountAmount,
    totalDiscount,
    total: Math.max(0, subtotal - totalDiscount),
  }
}

/**
 * What a fixed cart discount actually takes off when the cart is smaller than
 * the amount saved, or `null` when it applies whole (or is a percentage).
 */
export function cappedTransactionDiscount(
  transactionDiscount: DiscountEntry | null,
  transactionDiscountAmount: number,
): number | null {
  if (transactionDiscount?.type !== "fixed") return null
  return transactionDiscount.value > transactionDiscountAmount ? transactionDiscountAmount : null
}

/** Float noise allowed when splitting rupiah, as `ROUNDING_TOLERANCE` in Rust. */
const ROUNDING_TOLERANCE = 1e-6

/**
 * What each line actually brings in, in cart order: its total less its own
 * discount, less its share of the transaction discount. Mirrors
 * `prorated_line_nets` in `services/transactions/checkout/discounts.rs`, so a
 * check made here (a PPOB line sold below cost) agrees with the server's.
 *
 * The transaction discount is spread by each line's weight after its own
 * discount. Every share is whole rupiah: the raw nets are floored and the
 * rupiah left over go one each to the lines with a positive remainder, largest
 * first (ties to the earlier line). Only sub-rupiah money leaves a residue; it
 * goes on the line furthest below its raw share, so a zero line is never
 * rounded up and no line is cut below its floored share.
 */
export function cartLineNets(
  items: CartItem[],
  itemDiscounts: Record<string, DiscountEntry>,
  transactionDiscount: DiscountEntry | null,
): number[] {
  const lineNets = items.map((item) => {
    const lineTotal = item.product_price * item.quantity
    const disc = itemDiscounts[item.cart_id]
    return lineTotal - (disc ? discountAmount(lineTotal, disc) : 0)
  })
  const netTotal = lineNets.reduce((sum, net) => sum + net, 0)
  if (netTotal <= 0) return lineNets.map(() => 0)

  const { transactionDiscountAmount } = computeCartTotals(items, itemDiscounts, transactionDiscount)
  // No cart discount: each line keeps its own amount, unrounded (as the server).
  if (transactionDiscountAmount === 0) return lineNets
  const target = Math.max(netTotal - transactionDiscountAmount, 0)
  const keptRatio = target / netTotal
  const raw = lineNets.map((net) => net * keptRatio)
  const nets = raw.map((value) => Math.floor(value))

  const floorSum = nets.reduce((sum, net) => sum + net, 0)
  const units = Math.max(Math.floor(target - floorSum + ROUNDING_TOLERANCE), 0)
  const order = raw
    .map((_, index) => index)
    .filter((index) => raw[index] - nets[index] > 0)
    .sort((a, b) => raw[b] - nets[b] - (raw[a] - nets[a]) || a - b)
  for (const index of order.slice(0, units)) nets[index] += 1

  const residue = target - nets.reduce((sum, net) => sum + net, 0)
  if (Math.abs(residue) > ROUNDING_TOLERANCE) {
    // The line furthest below its raw share, the earlier one on a tie.
    let furthestBelow = -1
    raw.forEach((value, index) => {
      if (value <= 0) return
      if (furthestBelow < 0 || value - nets[index] > raw[furthestBelow] - nets[furthestBelow]) {
        furthestBelow = index
      }
    })
    if (furthestBelow >= 0) nets[furthestBelow] += residue
  }
  return nets
}

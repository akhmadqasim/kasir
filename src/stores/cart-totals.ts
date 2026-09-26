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

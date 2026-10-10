import { netAmountForQuantity, type PricedLine } from "@/lib/line-amounts"

/** A sold line coming back, as much of it as the exchange needs. */
export interface ReturnedLine extends PricedLine {
  /** `null` for a PPOB line: nothing to swap like-for-like. */
  product_id: number | null
  /** Units of the line coming back. */
  returnedQuantity: number
}

/** A replacement as the cashier picked it, at the catalogue's price. */
export interface ExchangePick {
  product_id: number
  sell_price: number
  quantity: number
}

export interface ExchangeLinePrice {
  /** Units priced at what the customer paid for the same product. */
  matchedQuantity: number
  /** What the replacement line costs the customer. */
  subtotal: number
  /** `subtotal / quantity`, or `sell_price` when nothing was matched. */
  unitPrice: number
}

/**
 * Prices an exchange's replacements as the server books them (`record_exchange`
 * in `services/refunds/create/exchange.rs`): at `sell_price`, except units of a
 * product returned in the same exchange, which cost what the customer paid for
 * them, so a like-for-like swap nets to zero. Returned units are pooled per
 * product and handed out in the order the replacements are listed.
 */
export function priceExchangeItems(
  returned: readonly ReturnedLine[],
  picks: readonly ExchangePick[],
): ExchangeLinePrice[] {
  // Per product: units not yet matched, and the money they were refunded at.
  const credit = new Map<number, { units: number; amount: number }>()
  for (const line of returned) {
    if (line.product_id === null) continue
    const entry = credit.get(line.product_id) ?? { units: 0, amount: 0 }
    entry.units += line.returnedQuantity
    entry.amount += netAmountForQuantity(line, line.returnedQuantity)
    credit.set(line.product_id, entry)
  }

  return picks.map(({ product_id, sell_price, quantity }) => {
    const entry = credit.get(product_id)
    const matched = entry ? Math.min(quantity, entry.units) : 0
    let matchedAmount = 0
    if (entry && matched > 0) {
      // The last unit takes the exact remainder, so a full swap nets to zero.
      matchedAmount =
        matched === entry.units ? entry.amount : (entry.amount * matched) / entry.units
      entry.units -= matched
      entry.amount -= matchedAmount
    }
    const subtotal = matchedAmount + sell_price * (quantity - matched)
    const unitPrice = matched === 0 ? sell_price : subtotal / quantity
    return { matchedQuantity: matched, subtotal, unitPrice }
  })
}

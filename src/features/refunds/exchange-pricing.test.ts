import { describe, expect, it } from "vitest"

import { priceExchangeItems, type ReturnedLine } from "./exchange-pricing"

function returned(overrides: Partial<ReturnedLine> = {}): ReturnedLine {
  return {
    product_id: 3,
    quantity: 2,
    subtotal: 30000,
    net_subtotal: 30000,
    returnedQuantity: 2,
    ...overrides,
  }
}

/** Mirrors `ReturnedCredit` / `record_exchange` in services/refunds/create/exchange.rs. */
describe("priceExchangeItems", () => {
  it("sells a different product at today's price", () => {
    expect(
      priceExchangeItems([returned()], [{ product_id: 4, sell_price: 18000, quantity: 2 }]),
    ).toEqual([{ matchedQuantity: 0, subtotal: 36000, unitPrice: 18000 }])
  })

  it("pools the returned units of one product across the sale's lines", () => {
    // Two lines of the same product: Rp10.000 and Rp12.000 paid per unit.
    const lines = [
      returned({ quantity: 1, subtotal: 15000, net_subtotal: 10000, returnedQuantity: 1 }),
      returned({ quantity: 1, subtotal: 15000, net_subtotal: 12000, returnedQuantity: 1 }),
    ]

    const [line] = priceExchangeItems(lines, [{ product_id: 3, sell_price: 15000, quantity: 2 }])

    expect(line).toEqual({ matchedQuantity: 2, subtotal: 22000, unitPrice: 11000 })
  })

  it("hands the returned units out in the order the replacements are listed", () => {
    const prices = priceExchangeItems(
      [returned({ net_subtotal: 27000, returnedQuantity: 2 })],
      [
        { product_id: 3, sell_price: 15000, quantity: 1 },
        { product_id: 3, sell_price: 15000, quantity: 2 },
      ],
    )

    expect(prices).toEqual([
      { matchedQuantity: 1, subtotal: 13500, unitPrice: 13500 },
      { matchedQuantity: 1, subtotal: 13500 + 15000, unitPrice: 14250 },
    ])
  })

  it("never matches a PPOB line, which has no product", () => {
    expect(
      priceExchangeItems(
        [returned({ product_id: null })],
        [{ product_id: 3, sell_price: 15000, quantity: 1 }],
      ),
    ).toEqual([{ matchedQuantity: 0, subtotal: 15000, unitPrice: 15000 }])
  })
})

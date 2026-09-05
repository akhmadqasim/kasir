import { describe, expect, it } from "vitest"
import {
  isDiscountedLine,
  lineDiscountAmount,
  netAmountForQuantity,
  netLineAmount,
  netUnitAmount,
  type PricedLine,
} from "./line-amounts"

function line(overrides: Partial<PricedLine> = {}): PricedLine {
  return { quantity: 1, subtotal: 10_000, net_subtotal: 10_000, ...overrides }
}

describe("netLineAmount", () => {
  it("returns the list amount when nothing was discounted", () => {
    expect(netLineAmount(line({ quantity: 2, subtotal: 20_000, net_subtotal: 20_000 }))).toBe(20_000)
  })

  it("returns what was paid, not the list price", () => {
    expect(netLineAmount(line({ quantity: 2, subtotal: 20_000, net_subtotal: 15_000 }))).toBe(15_000)
  })

  // The whole point of the column: a receipt's lines must add up to its total.
  it("sums to the transaction total across a discounted sale", () => {
    const items = [
      line({ quantity: 2, subtotal: 20_000, net_subtotal: 18_000 }),
      line({ quantity: 1, subtotal: 5_000, net_subtotal: 4_500 }),
    ]
    const total = items.reduce((sum, item) => sum + netLineAmount(item), 0)
    expect(total).toBe(22_500)
  })
})

describe("netUnitAmount", () => {
  it("splits the paid amount evenly across the units", () => {
    expect(netUnitAmount(line({ quantity: 4, subtotal: 40_000, net_subtotal: 30_000 }))).toBe(7_500)
  })

  it("does not divide by a zero quantity", () => {
    expect(netUnitAmount(line({ quantity: 0, subtotal: 0, net_subtotal: 0 }))).toBe(0)
  })
})

describe("netAmountForQuantity", () => {
  it("refunds a partial quantity at the price actually paid", () => {
    const sold = line({ quantity: 3, subtotal: 150_000, net_subtotal: 120_000 })
    expect(netAmountForQuantity(sold, 2)).toBe(80_000)
  })

  it("returns nothing for a zero quantity", () => {
    expect(netAmountForQuantity(line({ quantity: 2, subtotal: 20_000, net_subtotal: 16_000 }), 0)).toBe(0)
  })
})

describe("lineDiscountAmount", () => {
  it("covers the item discount and the prorated transaction discount together", () => {
    expect(lineDiscountAmount(line({ quantity: 1, subtotal: 50_000, net_subtotal: 40_000 }))).toBe(10_000)
  })

  it("never reports a negative discount", () => {
    expect(lineDiscountAmount(line({ subtotal: 10_000, net_subtotal: 12_000 }))).toBe(0)
  })
})

describe("isDiscountedLine", () => {
  it("ignores floating-point noise below half a rupiah", () => {
    expect(isDiscountedLine(line({ subtotal: 10_000, net_subtotal: 9_999.999 }))).toBe(false)
    expect(isDiscountedLine(line({ subtotal: 10_000, net_subtotal: 9_990 }))).toBe(true)
  })
})

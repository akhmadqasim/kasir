import { describe, expect, it } from "vitest"

import { profitTone, profitToneClass, sumSalesRows } from "./sales-totals"

describe("sumSalesRows", () => {
  it("adds every figure across the rows", () => {
    expect(
      sumSalesRows([
        { transactionCount: 3, totalRevenue: 45000, totalCost: 30000, grossProfit: 15000 },
        { transactionCount: 2, totalRevenue: 20000, totalCost: 26000, grossProfit: -6000 },
      ]),
    ).toEqual({ transactions: 5, revenue: 65000, cost: 56000, profit: 9000 })
  })

  it("is all zeros for an empty period", () => {
    expect(sumSalesRows([])).toEqual({ transactions: 0, revenue: 0, cost: 0, profit: 0 })
  })
})

describe("profitTone", () => {
  it("never shows a loss in green", () => {
    expect(profitTone(-1)).toBe("danger")
    expect(profitToneClass(-0.5)).toBe("text-danger")
  })

  it("shows zero and positive profit as success", () => {
    expect(profitTone(0)).toBe("success")
    expect(profitTone(1500)).toBe("success")
    expect(profitToneClass(1500)).toBe("text-success")
  })
})

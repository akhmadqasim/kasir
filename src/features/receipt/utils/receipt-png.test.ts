import { describe, expect, it } from "vitest"

import { receiptColumns } from "./receipt-png"

describe("receiptColumns", () => {
  it("uses 42 columns for 80 mm paper", () => {
    expect(receiptColumns(80)).toBe(42)
  })

  it("defaults to 32 columns otherwise", () => {
    expect(receiptColumns(58)).toBe(32)
    expect(receiptColumns(null)).toBe(32)
    expect(receiptColumns(undefined)).toBe(32)
  })
})

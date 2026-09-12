import { describe, expect, it } from "vitest"

import {
  allowedWriteoffReasons,
  canEditProduct,
  canSeeBuyPrice,
  isLowStock,
  resolveStockCount,
  validateWriteoffQuantity,
} from "../stock/rules"

describe("write-off reasons per role", () => {
  it("lets an admin pick every reason", () => {
    expect(allowedWriteoffReasons("admin")).toEqual(["damaged", "expired", "lost", "other"])
  })

  it("keeps a kasir to reasons with physical proof", () => {
    expect(allowedWriteoffReasons("kasir")).toEqual(["damaged", "expired"])
  })

  it("hides the buying price and product edits from a kasir", () => {
    expect(canSeeBuyPrice("kasir")).toBe(false)
    expect(canEditProduct("kasir")).toBe(false)
    expect(canSeeBuyPrice("admin")).toBe(true)
    expect(canEditProduct("admin")).toBe(true)
  })
})

describe("resolveStockCount", () => {
  it("is a match when counted equals system", () => {
    expect(resolveStockCount({ role: "kasir", systemStock: 5, countedStock: 5 })).toEqual({
      kind: "match",
    })
  })

  it("lets an admin adjust in either direction", () => {
    expect(resolveStockCount({ role: "admin", systemStock: 5, countedStock: 8 })).toEqual({
      kind: "adjust",
      newStock: 8,
      difference: 3,
    })
    expect(resolveStockCount({ role: "admin", systemStock: 5, countedStock: 2 })).toEqual({
      kind: "adjust",
      newStock: 2,
      difference: -3,
    })
  })

  it("turns an admin's explained shortfall into a write-off for the audit trail", () => {
    expect(
      resolveStockCount({
        role: "admin",
        systemStock: 5,
        countedStock: 2,
        writeoffReason: "lost",
      }),
    ).toEqual({ kind: "writeoff", quantity: 3, difference: -3 })
  })

  it("blocks a kasir on a surplus", () => {
    expect(resolveStockCount({ role: "kasir", systemStock: 5, countedStock: 6 })).toEqual({
      kind: "blocked",
      difference: 1,
      reason: "surplus_needs_admin",
    })
  })

  it("lets a kasir write off a shortfall as damaged or expired only", () => {
    expect(
      resolveStockCount({
        role: "kasir",
        systemStock: 5,
        countedStock: 3,
        writeoffReason: "damaged",
      }),
    ).toEqual({ kind: "writeoff", quantity: 2, difference: -2 })

    expect(
      resolveStockCount({ role: "kasir", systemStock: 5, countedStock: 3, writeoffReason: "lost" }),
    ).toEqual({ kind: "blocked", difference: -2, reason: "admin_only" })

    expect(resolveStockCount({ role: "kasir", systemStock: 5, countedStock: 3 })).toEqual({
      kind: "blocked",
      difference: -2,
      reason: "admin_only",
    })
  })
})

describe("validateWriteoffQuantity", () => {
  it("mirrors the server's two checks", () => {
    expect(validateWriteoffQuantity(0, 5)).toBe("not_positive")
    expect(validateWriteoffQuantity(-1, 5)).toBe("not_positive")
    expect(validateWriteoffQuantity(1.5, 5)).toBe("not_positive")
    expect(validateWriteoffQuantity(6, 5)).toBe("exceeds_stock")
    expect(validateWriteoffQuantity(5, 5)).toBeNull()
  })
})

describe("isLowStock", () => {
  it("uses stock <= COALESCE(min_stock, 0)", () => {
    expect(isLowStock({ stock: 3, min_stock: 5 })).toBe(true)
    expect(isLowStock({ stock: 5, min_stock: 5 })).toBe(true)
    expect(isLowStock({ stock: 6, min_stock: 5 })).toBe(false)
    expect(isLowStock({ stock: 0, min_stock: null })).toBe(true)
    expect(isLowStock({ stock: 1, min_stock: null })).toBe(false)
  })
})

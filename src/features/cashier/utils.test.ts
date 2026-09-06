import { describe, expect, it } from "vitest"
import { getQuantityWarning } from "./utils"
import { MAX_CART_QUANTITY } from "./hooks/use-cart-store"

const makeItem = (overrides: Partial<{ stock: number; unit: string; is_ppob: boolean }> = {}) => ({
  stock: 10,
  unit: "pcs",
  ...overrides,
})

describe("getQuantityWarning", () => {
  it("stays quiet while the quantity fits the stock", () => {
    expect(getQuantityWarning(makeItem(), 10)).toBeNull()
  })

  it("warns when the quantity exceeds the available stock", () => {
    expect(getQuantityWarning(makeItem({ stock: 3 }), 5)).toBe(
      "Melebihi stok tersedia (3 pcs) — stok akan minus",
    )
  })

  it("warns when the product has no stock left", () => {
    expect(getQuantityWarning(makeItem({ stock: 0 }), 1)).toBe(
      "Stok habis — pastikan stok sudah diperbarui",
    )
  })

  it("warns when the quantity passes the cap", () => {
    expect(getQuantityWarning(makeItem({ stock: 100000 }), MAX_CART_QUANTITY + 1)).toBe(
      "Jumlah maksimal 9.999 per baris",
    )
  })

  it("stays quiet for PPOB items", () => {
    expect(getQuantityWarning(makeItem({ stock: 0, is_ppob: true }), 1)).toBeNull()
  })
})

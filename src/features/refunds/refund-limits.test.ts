import { describe, expect, it } from "vitest"
import {
  hasRefundedLines,
  parseRemainingQuantityError,
  remainingQuantityMessage,
  remainingRefundableQuantity,
} from "./refund-limits"

describe("remainingRefundableQuantity", () => {
  it("offers the whole line when nothing came back yet", () => {
    expect(remainingRefundableQuantity({ quantity: 3, refunded_quantity: 0 })).toBe(3)
  })

  it("takes earlier refunds off the purchased quantity", () => {
    expect(remainingRefundableQuantity({ quantity: 3, refunded_quantity: 2 })).toBe(1)
  })

  it("is zero for a line returned in full", () => {
    expect(remainingRefundableQuantity({ quantity: 2, refunded_quantity: 2 })).toBe(0)
  })

  it("never goes negative on inconsistent data", () => {
    expect(remainingRefundableQuantity({ quantity: 1, refunded_quantity: 4 })).toBe(0)
    expect(remainingRefundableQuantity({ quantity: 2, refunded_quantity: -1 })).toBe(2)
  })
})

describe("hasRefundedLines", () => {
  it("is true once any line has come back", () => {
    expect(
      hasRefundedLines([
        { quantity: 2, refunded_quantity: 0 },
        { quantity: 1, refunded_quantity: 1 },
      ]),
    ).toBe(true)
    expect(hasRefundedLines([{ quantity: 2, refunded_quantity: 0 }])).toBe(false)
    expect(hasRefundedLines([])).toBe(false)
  })
})

describe("parseRemainingQuantityError", () => {
  // Exact wording of the refund service (`services/refunds/`).
  it("reads the remainder out of the backend's rejection", () => {
    expect(
      parseRemainingQuantityError(
        "Jumlah refund 3 melebihi sisa yang bisa di-refund (1) untuk Beras Premium 5kg",
      ),
    ).toEqual({ remaining: 1, productName: "Beras Premium 5kg" })
  })

  it("reads a remainder of zero", () => {
    expect(
      parseRemainingQuantityError(
        "Jumlah refund 1 melebihi sisa yang bisa di-refund (0) untuk Minyak Goreng",
      ),
    ).toEqual({ remaining: 0, productName: "Minyak Goreng" })
  })

  it("keeps a product name that contains brackets", () => {
    expect(
      parseRemainingQuantityError(
        "Jumlah refund 2 melebihi sisa yang bisa di-refund (1) untuk Gula (1 kg)",
      ),
    ).toEqual({ remaining: 1, productName: "Gula (1 kg)" })
  })

  it("ignores every other validation error", () => {
    expect(parseRemainingQuantityError("Item refund tidak boleh kosong")).toBeNull()
    expect(
      parseRemainingQuantityError("Refund hanya bisa dilakukan maksimal 7 hari setelah pembelian"),
    ).toBeNull()
    expect(parseRemainingQuantityError(null)).toBeNull()
    expect(parseRemainingQuantityError("")).toBeNull()
  })
})

describe("remainingQuantityMessage", () => {
  it("tells the cashier the new cap", () => {
    expect(remainingQuantityMessage({ remaining: 1, productName: "Beras" })).toContain("tinggal 1")
  })

  it("says outright when nothing is left", () => {
    expect(remainingQuantityMessage({ remaining: 0, productName: "Beras" })).toContain(
      "sudah diretur seluruhnya",
    )
  })
})

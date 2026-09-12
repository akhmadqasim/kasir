import { describe, expect, it } from "vitest"
import { parseRemainingQuantityError, remainingQuantityMessage } from "./refund-limits"

describe("parseRemainingQuantityError", () => {
  // Exact wording of `create_refund_internal` in commands/refunds.rs.
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

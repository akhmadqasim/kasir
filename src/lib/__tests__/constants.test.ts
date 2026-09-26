import { describe, it, expect } from "vitest"
import { MAX_REFUND_DAYS, ITEMS_PER_PAGE, SEARCH_DEBOUNCE_MS } from "../constants"

describe("constants", () => {
  it("max refund days is 7 (business rule)", () => {
    expect(MAX_REFUND_DAYS).toBe(7)
  })

  it("items per page is 50", () => {
    expect(ITEMS_PER_PAGE).toBe(50)
  })

  it("search debounce is 300ms", () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(300)
  })
})

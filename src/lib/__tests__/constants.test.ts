import { describe, it, expect } from "vitest"
import {
  APP_NAME,
  DB_NAME,
  RECEIPT_PREFIX,
  REFUND_PREFIX,
  WRITEOFF_PREFIX,
  MAX_REFUND_DAYS,
  ITEMS_PER_PAGE,
  SEARCH_DEBOUNCE_MS,
} from "../constants"

describe("constants", () => {
  it("APP_NAME is set", () => {
    expect(APP_NAME).toBe("POS Toko Sembako")
  })

  it("DB_NAME uses .db extension", () => {
    expect(DB_NAME).toBe("kasir.db")
  })

  it("receipt prefix format", () => {
    expect(RECEIPT_PREFIX).toBe("TRX")
  })

  it("refund prefix format", () => {
    expect(REFUND_PREFIX).toBe("RFD")
  })

  it("writeoff prefix format", () => {
    expect(WRITEOFF_PREFIX).toBe("WO")
  })

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

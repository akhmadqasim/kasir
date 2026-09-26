import { describe, expect, it } from "vitest"

import {
  ALL,
  defaultTransactionFilters,
  hasActiveFilters,
  transactionListParams,
} from "./transaction-filters"

describe("hasActiveFilters", () => {
  it("treats today's sales with no other filter as unfiltered", () => {
    expect(hasActiveFilters(defaultTransactionFilters())).toBe(false)
  })

  it("flags every filter that differs from the default", () => {
    const base = defaultTransactionFilters()
    expect(hasActiveFilters({ ...base, channel: "ppob" })).toBe(true)
    expect(hasActiveFilters({ ...base, search: "TRX" })).toBe(true)
    expect(hasActiveFilters({ ...base, paymentMethod: "cash" })).toBe(true)
    expect(hasActiveFilters({ ...base, status: "deleted" })).toBe(true)
    expect(hasActiveFilters({ ...base, dateRange: { from: new Date(2026, 0, 1) } })).toBe(true)
  })
})

describe("transactionListParams", () => {
  it("leaves every 'any' filter out of the request", () => {
    const params = transactionListParams({ ...defaultTransactionFilters(), channel: ALL }, "", 3)
    expect(params).toMatchObject({ page: 3, per_page: 50 })
    expect(params.channel).toBeUndefined()
    expect(params.search).toBeUndefined()
    expect(params.payment_method).toBeUndefined()
    expect(params.status).toBeUndefined()
  })

  it("sends the debounced search, not the one being typed", () => {
    const filters = { ...defaultTransactionFilters(), search: "TRX-2026" }
    expect(transactionListParams(filters, "TRX", 1).search).toBe("TRX")
  })
})

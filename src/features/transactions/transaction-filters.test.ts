import { describe, expect, it } from "vitest"

import {
  ALL,
  PPOB_UNCERTAIN_FILTER,
  STATUS_FILTERS,
  defaultTransactionFilters,
  hasActiveFilters,
  ppobAttentionFilters,
  statusFilterPatch,
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

describe("PPOB status filters", () => {
  it("offers 'Perlu dicek' next to the other PPOB filters", () => {
    const keys: string[] = STATUS_FILTERS.map((option) => option.key)
    expect(keys).toEqual(expect.arrayContaining(["pending_ppob", "ppob_failed", "ppob_uncertain"]))
    const uncertain = STATUS_FILTERS.find((option) => option.key === PPOB_UNCERTAIN_FILTER)
    expect(uncertain?.label).toBe("Perlu dicek")
  })

  it("drops today-only and the sales channel when a PPOB line filter is picked", () => {
    for (const status of ["pending_ppob", "ppob_failed", PPOB_UNCERTAIN_FILTER]) {
      expect(statusFilterPatch(status)).toEqual({ status, channel: ALL, dateRange: undefined })
    }
    // A sale status keeps the dates the cashier chose.
    expect(statusFilterPatch("refunded")).toEqual({ status: "refunded" })
  })

  it("leads the indicator to every uncertain line, of any day and channel", () => {
    const params = transactionListParams(ppobAttentionFilters(), "", 1)
    expect(params.status).toBe(PPOB_UNCERTAIN_FILTER)
    expect(params.channel).toBeUndefined()
    expect(params.date_from).toBeUndefined()
    expect(params.date_to).toBeUndefined()
  })
})

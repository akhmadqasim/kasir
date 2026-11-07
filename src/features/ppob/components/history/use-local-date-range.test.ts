import { describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"

import { toLocalDateString } from "@/lib/format"
import { getDefaultDateRange } from "./history-utils"
import { useLocalDateRange } from "./use-local-date-range"

describe("useLocalDateRange", () => {
  it("defaults to the default range", () => {
    const { result } = renderHook(() => useLocalDateRange())
    const defaults = getDefaultDateRange()
    expect(result.current.startDate).toBe(defaults.start)
    expect(result.current.endDate).toBe(defaults.end)
  })

  it("uses local date strings of the picked range", () => {
    const { result } = renderHook(() => useLocalDateRange())
    const from = new Date(2026, 0, 5, 23, 30)
    const to = new Date(2026, 0, 9, 0, 15)
    act(() => result.current.setDateRange({ from, to }))
    expect(result.current.startDate).toBe(toLocalDateString(from))
    expect(result.current.endDate).toBe("2026-01-09")
  })

  it("falls back to defaults when cleared", () => {
    const { result } = renderHook(() => useLocalDateRange())
    act(() => result.current.setDateRange(undefined))
    expect(result.current.startDate).toBe(getDefaultDateRange().start)
  })
})

import { describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"

import { toLocalDateString } from "@/lib/format"
import { useReportDateRange } from "./use-report-date-range"

describe("useReportDateRange", () => {
  it("falls back endDate to startDate for a half range", () => {
    const { result } = renderHook(() => useReportDateRange())
    const from = new Date(2026, 0, 5)
    act(() => result.current.setDateRange({ from, to: undefined }))
    expect(result.current.startDate).toBe(toLocalDateString(from))
    expect(result.current.endDate).toBe(toLocalDateString(from))
  })

  it("returns empty strings when cleared", () => {
    const { result } = renderHook(() => useReportDateRange())
    act(() => result.current.setDateRange(undefined))
    expect(result.current.startDate).toBe("")
    expect(result.current.endDate).toBe("")
  })

  it("formats a full range", () => {
    const { result } = renderHook(() => useReportDateRange())
    const from = new Date(2026, 0, 1)
    const to = new Date(2026, 0, 31)
    act(() => result.current.setDateRange({ from, to }))
    expect(result.current.endDate).toBe(toLocalDateString(to))
  })
})

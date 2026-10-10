import { describe, expect, it } from "vitest"

import { TIME_RANGE_OPTIONS, daysForRange } from "./components/time-range"

describe("daysForRange", () => {
  it("maps every option to the days the backend is asked for", () => {
    expect(daysForRange("7d")).toBe(7)
    expect(daysForRange("1m")).toBe(30)
    expect(daysForRange("3m")).toBe(90)
    expect(daysForRange("6m")).toBe(180)
    expect(daysForRange("1y")).toBe(365)
  })

  it("falls back to one week for an unknown key", () => {
    expect(daysForRange("")).toBe(7)
    expect(daysForRange("2y")).toBe(7)
  })

  it("lists the ranges shortest first, each with a unique key", () => {
    const days = TIME_RANGE_OPTIONS.map((option) => option.days)
    expect(days).toEqual([...days].sort((a, b) => a - b))
    expect(new Set(TIME_RANGE_OPTIONS.map((option) => option.key)).size).toBe(
      TIME_RANGE_OPTIONS.length,
    )
  })
})

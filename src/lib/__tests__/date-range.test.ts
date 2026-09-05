import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_RANGE_DAYS,
  getDefaultDateRange,
  getTodayRange,
} from "../date-range"
import { toLocalDateString } from "../format"

/** Tengah hari lokal, jauh dari batas hari, supaya assertion tidak bergantung timezone. */
function setNow(year: number, month: number, day: number) {
  vi.setSystemTime(new Date(year, month - 1, day, 12, 0, 0))
}

describe("getDefaultDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("ends today and starts 30 days earlier by default", () => {
    setNow(2026, 9, 5)
    const range = getDefaultDateRange()

    expect(DEFAULT_RANGE_DAYS).toBe(30)
    expect(toLocalDateString(range.to!)).toBe("2026-09-05")
    expect(toLocalDateString(range.from!)).toBe("2026-08-06")
  })

  it("honours a custom length", () => {
    setNow(2026, 9, 5)
    const range = getDefaultDateRange(7)

    expect(toLocalDateString(range.from!)).toBe("2026-08-29")
    expect(toLocalDateString(range.to!)).toBe("2026-09-05")
  })

  it("walks back across a month boundary", () => {
    setNow(2026, 3, 5)
    const range = getDefaultDateRange()

    expect(toLocalDateString(range.from!)).toBe("2026-02-03")
  })

  it("returns two independent Date objects", () => {
    setNow(2026, 9, 5)
    const range = getDefaultDateRange()

    range.from!.setDate(1)
    expect(toLocalDateString(range.to!)).toBe("2026-09-05")
  })
})

describe("getTodayRange", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("covers today on both ends", () => {
    setNow(2026, 9, 5)
    const range = getTodayRange()

    expect(toLocalDateString(range.from!)).toBe("2026-09-05")
    expect(toLocalDateString(range.to!)).toBe("2026-09-05")
  })

  it("returns two independent Date objects", () => {
    setNow(2026, 9, 5)
    const range = getTodayRange()

    range.from!.setDate(1)
    expect(toLocalDateString(range.to!)).toBe("2026-09-05")
  })
})

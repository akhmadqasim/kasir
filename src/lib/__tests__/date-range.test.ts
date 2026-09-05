import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_RANGE_DAYS,
  getDefaultDateRange,
  getTodayRange,
  resolveRangeSelection,
  type DateRange,
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

describe("resolveRangeSelection", () => {
  const clicked = new Date(2026, 8, 5)

  it("turns a cleared selection into a single-day range", () => {
    // Apa yang dikirim react-day-picker saat hari yang diklik sama dengan kedua ujung
    // rentang. Tanpa ini filter terkirim kosong dan laporan menampilkan "Tidak ada data".
    const range = resolveRangeSelection(undefined, clicked)

    expect(range.from).toBe(clicked)
    expect(range.to).toBe(clicked)
  })

  it("keeps a complete range untouched", () => {
    const selected: DateRange = {
      from: new Date(2026, 7, 1),
      to: new Date(2026, 7, 31),
    }

    expect(resolveRangeSelection(selected, clicked)).toBe(selected)
  })

  it("keeps a half-open range so the second click can finish it", () => {
    const selected: DateRange = { from: new Date(2026, 7, 1), to: undefined }

    expect(resolveRangeSelection(selected, clicked)).toBe(selected)
  })

  it("falls back to the clicked day when only the end is set", () => {
    const range = resolveRangeSelection(
      { from: undefined, to: new Date(2026, 7, 31) },
      clicked
    )

    expect(range.from).toBe(clicked)
    expect(range.to).toBe(clicked)
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

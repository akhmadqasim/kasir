import { describe, expect, it } from "vitest"
import { isWithinLocalDateRange, normalizeStatus, parseMutasiDate } from "./history-utils"

describe("parseMutasiDate", () => {
  // Payment history shape.
  it("reads a year-first timestamp", () => {
    const date = parseMutasiDate("2026-09-05 14:30:00")
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(8)
    expect(date?.getDate()).toBe(5)
    expect(date?.getHours()).toBe(14)
  })

  // `formatted_date` shape, which `new Date()` alone reads as Invalid Date.
  it("reads a day-first timestamp", () => {
    const date = parseMutasiDate("05-09-2026 14:30:00")
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(8)
    expect(date?.getDate()).toBe(5)
  })

  it("reads a day-first date with slashes and no time", () => {
    const date = parseMutasiDate("31/12/2026")
    expect(date?.getMonth()).toBe(11)
    expect(date?.getDate()).toBe(31)
  })

  it("returns nothing for a value it cannot read", () => {
    expect(parseMutasiDate(null)).toBeNull()
    expect(parseMutasiDate("")).toBeNull()
    expect(parseMutasiDate("-")).toBeNull()
  })
})

describe("isWithinLocalDateRange", () => {
  // `topup/history` ignores dates entirely, so the whole topup history comes back
  // and the range has to be applied here.
  it("keeps a topup inside the selected range", () => {
    expect(isWithinLocalDateRange("2026-09-05 08:00:00", "2026-09-01", "2026-09-07")).toBe(true)
  })

  it("includes both ends of the range", () => {
    expect(isWithinLocalDateRange("2026-09-01 00:05:00", "2026-09-01", "2026-09-07")).toBe(true)
    expect(isWithinLocalDateRange("2026-09-07 23:55:00", "2026-09-01", "2026-09-07")).toBe(true)
  })

  it("drops a topup from before the range", () => {
    expect(isWithinLocalDateRange("2026-08-30 10:00:00", "2026-09-01", "2026-09-07")).toBe(false)
  })

  it("drops a topup from after the range", () => {
    expect(isWithinLocalDateRange("2026-09-09 10:00:00", "2026-09-01", "2026-09-07")).toBe(false)
  })

  it("handles the day-first format the same way", () => {
    expect(isWithinLocalDateRange("05-09-2026 08:00:00", "2026-09-01", "2026-09-07")).toBe(true)
    expect(isWithinLocalDateRange("30-08-2026 08:00:00", "2026-09-01", "2026-09-07")).toBe(false)
  })

  it("reports an unreadable timestamp as outside the range", () => {
    expect(isWithinLocalDateRange(null, "2026-09-01", "2026-09-07")).toBe(false)
  })
})

describe("normalizeStatus", () => {
  it("maps the vendor's status vocabulary", () => {
    expect(normalizeStatus("SUKSES")).toBe("sukses")
    expect(normalizeStatus("failed")).toBe("gagal")
    expect(normalizeStatus("pending")).toBe("proses")
    expect(normalizeStatus(null)).toBe("unknown")
  })
})

import { describe, expect, it } from "vitest"

import {
  formatNumber,
  formatRupiah,
  parseBackendDate,
  parseIndonesianInteger,
  parseIndonesianNumber,
  toLocalDateString,
} from "../format"

describe("formatRupiah", () => {
  it("prints whole rupiah with Indonesian grouping", () => {
    // Intl may use a regular or a non-breaking space after "Rp".
    expect(formatRupiah(150000).replace(/\s/g, " ")).toBe("Rp 150.000")
    expect(formatRupiah(0).replace(/\s/g, " ")).toBe("Rp 0")
  })
})

describe("formatNumber", () => {
  it("groups thousands with a dot", () => {
    expect(formatNumber(1234567)).toBe("1.234.567")
  })
})

describe("parseIndonesianNumber", () => {
  it("reads Indonesian and English separators", () => {
    expect(parseIndonesianNumber("1.234,56")).toBe(1234.56)
    expect(parseIndonesianNumber("2,500.75")).toBe(2500.75)
    expect(parseIndonesianNumber("1.234.567")).toBe(1234567)
    expect(parseIndonesianNumber("14.5")).toBe(14.5)
    expect(parseIndonesianNumber("1.234")).toBe(1234)
    expect(parseIndonesianNumber("Rp 14.000,-")).toBe(14000)
  })

  it("returns null for anything without a digit", () => {
    expect(parseIndonesianNumber("")).toBeNull()
    expect(parseIndonesianNumber("abc")).toBeNull()
    expect(parseIndonesianNumber(null)).toBeNull()
  })

  it("truncates to an integer for stock fields", () => {
    expect(parseIndonesianInteger("12,9")).toBe(12)
    expect(parseIndonesianInteger("-3")).toBe(-3)
  })
})

describe("parseBackendDate", () => {
  it("pins a bare SQLite timestamp to UTC", () => {
    expect(parseBackendDate("2026-09-05 01:00:00")?.toISOString()).toBe("2026-09-05T01:00:00.000Z")
  })

  it("leaves an explicit timezone alone", () => {
    expect(parseBackendDate("2026-09-05T01:00:00+07:00")?.toISOString()).toBe(
      "2026-09-04T18:00:00.000Z",
    )
  })

  it("returns null for nothing", () => {
    expect(parseBackendDate(null)).toBeNull()
    expect(parseBackendDate("nonsense")).toBeNull()
  })
})

describe("toLocalDateString", () => {
  it("uses the local calendar day", () => {
    expect(toLocalDateString(new Date(2026, 8, 6, 3, 0, 0))).toBe("2026-09-06")
  })
})

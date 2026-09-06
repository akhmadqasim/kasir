import { describe, it, expect } from "vitest"
import {
  formatDateTime,
  formatDayDate,
  formatRupiah,
  parseBackendDate,
  parseIndonesianInteger,
  parseIndonesianNumber,
  toLocalDateString,
} from "../format"

describe("formatRupiah", () => {
  it("formats positive integer amounts", () => {
    const result = formatRupiah(10000)
    // Intl.NumberFormat "id-ID" with currency "IDR"
    // Expected format: "Rp10.000" (no fraction digits)
    expect(result).toContain("10.000")
    expect(result).toMatch(/Rp\s?10\.000/)
  })

  it("formats zero", () => {
    const result = formatRupiah(0)
    expect(result).toMatch(/Rp\s?0/)
  })

  it("formats small amounts", () => {
    const result = formatRupiah(500)
    expect(result).toMatch(/Rp\s?500/)
  })

  it("formats large amounts with proper thousand separators", () => {
    const result = formatRupiah(1500000)
    expect(result).toMatch(/Rp\s?1\.500\.000/)
  })

  it("formats very large amounts (millions)", () => {
    const result = formatRupiah(50000000)
    expect(result).toMatch(/Rp\s?50\.000\.000/)
  })

  it("has no decimal places (minimumFractionDigits: 0)", () => {
    const result = formatRupiah(12345)
    // Should not contain comma or decimal fraction
    expect(result).not.toMatch(/,\d+$/)
    expect(result).toMatch(/Rp\s?12\.345/)
  })

  it("formats negative amounts", () => {
    const result = formatRupiah(-5000)
    expect(result).toContain("5.000")
  })

  it("rounds decimal values (no fraction digits)", () => {
    const result = formatRupiah(3999.7)
    // With maximumFractionDigits: 0, this should round
    expect(result).toMatch(/Rp\s?4\.000/)
  })

  it("formats typical POS amounts correctly", () => {
    // Common grocery prices in Indonesia
    expect(formatRupiah(3000)).toMatch(/Rp\s?3\.000/)
    expect(formatRupiah(25000)).toMatch(/Rp\s?25\.000/)
    expect(formatRupiah(150000)).toMatch(/Rp\s?150\.000/)
  })
})

describe("parseIndonesianNumber", () => {
  it("reads an Indonesian thousands separator instead of a decimal point", () => {
    // The bug this guards: parseFloat("14.000") === 14
    expect(parseIndonesianNumber("14.000")).toBe(14000)
    expect(parseIndonesianNumber("2.500")).toBe(2500)
    expect(parseIndonesianNumber("1.234.567")).toBe(1234567)
  })

  it("reads an Indonesian decimal comma", () => {
    // The bug this guards: "2500,5" collapsing to 25005
    expect(parseIndonesianNumber("2500,5")).toBe(2500.5)
    expect(parseIndonesianNumber("12,75")).toBe(12.75)
  })

  it("strips currency symbols, spaces and the trailing rupiah dash", () => {
    expect(parseIndonesianNumber("Rp 2.500")).toBe(2500)
    expect(parseIndonesianNumber("Rp14.000,-")).toBe(14000)
    expect(parseIndonesianNumber(" 3 000 ")).toBe(3000)
  })

  it("resolves both separators by taking the right-most one as the decimal mark", () => {
    expect(parseIndonesianNumber("1.234,56")).toBe(1234.56)
    expect(parseIndonesianNumber("2,500.75")).toBe(2500.75)
  })

  it("treats a single dot followed by exactly three digits as thousands", () => {
    // Documented rule for ambiguous input: "1.234" is 1234, not 1.234
    expect(parseIndonesianNumber("1.234")).toBe(1234)
    expect(parseIndonesianNumber("14.000")).toBe(14000)
  })

  it("treats a single dot with any other digit count as a decimal point", () => {
    expect(parseIndonesianNumber("14.5")).toBe(14.5)
    expect(parseIndonesianNumber("1.25")).toBe(1.25)
    expect(parseIndonesianNumber("1.2345")).toBe(1.2345)
  })

  it("treats repeated commas as thousands separators", () => {
    expect(parseIndonesianNumber("1,234,567")).toBe(1234567)
  })

  it("passes plain numbers through untouched", () => {
    expect(parseIndonesianNumber(14000)).toBe(14000)
    expect(parseIndonesianNumber("14000")).toBe(14000)
    expect(parseIndonesianNumber("0")).toBe(0)
  })

  it("keeps negative values negative", () => {
    expect(parseIndonesianNumber("-1.500")).toBe(-1500)
    expect(parseIndonesianNumber("-2500,5")).toBe(-2500.5)
  })

  it("returns null for input that holds no number", () => {
    expect(parseIndonesianNumber("")).toBeNull()
    expect(parseIndonesianNumber("   ")).toBeNull()
    expect(parseIndonesianNumber("gratis")).toBeNull()
    expect(parseIndonesianNumber(null)).toBeNull()
    expect(parseIndonesianNumber(undefined)).toBeNull()
    expect(parseIndonesianNumber(Number.NaN)).toBeNull()
  })
})

describe("parseIndonesianInteger", () => {
  it("reads Indonesian-formatted stock counts", () => {
    expect(parseIndonesianInteger("1.000")).toBe(1000)
    expect(parseIndonesianInteger("50")).toBe(50)
  })

  it("truncates toward zero", () => {
    expect(parseIndonesianInteger("1,5")).toBe(1)
    expect(parseIndonesianInteger("-1,5")).toBe(-1)
  })

  it("returns null for input that holds no number", () => {
    expect(parseIndonesianInteger("")).toBeNull()
    expect(parseIndonesianInteger("kosong")).toBeNull()
  })
})

describe("parseBackendDate", () => {
  it("reads a bare backend timestamp as UTC, not local time", () => {
    // SQLite stores "YYYY-MM-DD HH:MM:SS" in UTC, and that string is not ISO-8601,
    // so `new Date(str)` reads it as local time and drifts by the UTC offset.
    expect(parseBackendDate("2026-09-05 18:00:00")?.toISOString()).toBe("2026-09-05T18:00:00.000Z")
  })

  it("keeps a 01:00 WIB sale on the day the backend filed it", () => {
    const parsed = parseBackendDate("2026-09-05 18:00:00")
    const inJakarta = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    expect(parsed && inJakarta.format(parsed)).toBe("2026-09-06")
  })

  it("accepts a timestamp that already carries a timezone", () => {
    expect(parseBackendDate("2026-09-05T18:00:00Z")?.toISOString()).toBe("2026-09-05T18:00:00.000Z")
    expect(parseBackendDate("2026-09-06T01:00:00+07:00")?.toISOString()).toBe(
      "2026-09-05T18:00:00.000Z",
    )
  })

  it("accepts fractional seconds", () => {
    expect(parseBackendDate("2026-09-05 18:00:00.123")?.toISOString()).toBe(
      "2026-09-05T18:00:00.123Z",
    )
  })

  it("returns null for empty or unparseable input", () => {
    expect(parseBackendDate(null)).toBeNull()
    expect(parseBackendDate(undefined)).toBeNull()
    expect(parseBackendDate("")).toBeNull()
    expect(parseBackendDate("bukan tanggal")).toBeNull()
  })
})

describe("formatDateTime and formatDayDate", () => {
  it("formats a bare backend timestamp the same as its explicit UTC form", () => {
    expect(formatDateTime("2026-09-05 18:00:00")).toBe(formatDateTime("2026-09-05T18:00:00Z"))
    expect(formatDayDate("2026-09-05 18:00:00")).toBe(formatDayDate("2026-09-05T18:00:00Z"))
  })

  it("falls back for missing values", () => {
    expect(formatDateTime(null)).toBe("—")
    expect(formatDayDate(undefined)).toBe("—")
    expect(formatDateTime("", "-")).toBe("-")
  })

  it("falls back when the value cannot be parsed", () => {
    expect(formatDateTime("bukan tanggal")).toBe("—")
    expect(formatDayDate("bukan tanggal", "-")).toBe("-")
  })
})

describe("toLocalDateString", () => {
  it("keeps the local calendar day instead of shifting to UTC", () => {
    // `new Date(2026, 8, 6).toISOString().slice(0, 10)` yields "2026-09-05" in WIB.
    expect(toLocalDateString(new Date(2026, 8, 6))).toBe("2026-09-06")
    expect(toLocalDateString(new Date(2026, 0, 1))).toBe("2026-01-01")
  })

  it("pads month and day to two digits", () => {
    expect(toLocalDateString(new Date(2026, 2, 9))).toBe("2026-03-09")
  })
})

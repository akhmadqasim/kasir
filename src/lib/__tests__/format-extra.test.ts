import { describe, expect, it } from "vitest"

import {
  formatCompactRupiah,
  formatFileSize,
  formatNumber,
  formatPercent,
  parseIndonesianInteger,
  parseIndonesianNumber,
} from "../format"

describe("formatNumber", () => {
  it("groups thousands with a dot", () => {
    expect(formatNumber(1234)).toBe("1.234")
    expect(formatNumber(1234567)).toBe("1.234.567")
    expect(formatNumber(0)).toBe("0")
  })
})

describe("formatPercent", () => {
  it("keeps one decimal with an Indonesian comma and no percent sign", () => {
    expect(formatPercent(12.5)).toBe("12,5")
    expect(formatPercent(12.46)).toBe("12,5")
    expect(formatPercent(30)).toBe("30")
  })
})

describe("formatCompactRupiah", () => {
  it("shortens axis labels to thousands and millions without the currency", () => {
    expect(formatCompactRupiah(450000)).toMatch(/^450\s?rb$/)
    expect(formatCompactRupiah(1200000)).toMatch(/^1,2\s?jt$/)
    expect(formatCompactRupiah(0)).toBe("0")
    expect(formatCompactRupiah(1200000)).not.toContain("Rp")
  })
})

describe("formatFileSize", () => {
  it("picks bytes, kilobytes or megabytes", () => {
    expect(formatFileSize(512)).toBe("512 B")
    expect(formatFileSize(2048)).toBe("2.0 KB")
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB")
  })
})

describe("parseIndonesianNumber — cashier and spreadsheet edge cases", () => {
  it("reads a full Indonesian amount with thousands and decimals", () => {
    expect(parseIndonesianNumber("1.500.000,00")).toBe(1500000)
    expect(parseIndonesianNumber("Rp 1.234.567,89")).toBe(1234567.89)
  })

  it("reads an English amount with thousands and decimals", () => {
    expect(parseIndonesianNumber("1,234,567.89")).toBe(1234567.89)
  })

  it("treats accounting brackets and a minus before the currency as negative", () => {
    expect(parseIndonesianNumber("(1.500)")).toBe(-1500)
    expect(parseIndonesianNumber("-Rp 2.500")).toBe(-2500)
    expect(parseIndonesianNumber("Rp -2.500")).toBe(-2500)
  })

  it("does not read the rupiah dash shorthand as a minus sign", () => {
    expect(parseIndonesianNumber("Rp 14.000,-")).toBe(14000)
    expect(parseIndonesianNumber("14.000,-")).toBe(14000)
  })

  it("reads a bare decimal fraction", () => {
    expect(parseIndonesianNumber(",5")).toBe(0.5)
    expect(parseIndonesianNumber(".5")).toBe(0.5)
  })

  it("reads a percent cell as its number", () => {
    expect(parseIndonesianNumber("12,5%")).toBe(12.5)
    expect(parseIndonesianNumber("25 %")).toBe(25)
  })

  it("rejects infinite numbers", () => {
    expect(parseIndonesianNumber(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it("keeps zero as zero, not as a missing value", () => {
    expect(parseIndonesianNumber("Rp 0")).toBe(0)
    expect(parseIndonesianInteger("0")).toBe(0)
  })
})

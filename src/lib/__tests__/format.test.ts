import { describe, it, expect } from "vitest"
import { formatRupiah } from "../format"

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

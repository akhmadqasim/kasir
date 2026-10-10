import { describe, expect, it } from "vitest"

import { formatRupiah } from "@/lib/format"
import { refundTotalsSummary } from "./refund-summary"

describe("refundTotalsSummary", () => {
  it("shows only the refund total, emphasised, for a plain refund", () => {
    const rows = refundTotalsSummary({
      isExchange: false,
      totalRefund: 27000,
      totalExchange: 0,
      difference: 27000,
    })
    expect(rows).toEqual([{ label: "Total Refund", value: formatRupiah(27000), tone: "strong" }])
  })

  it("names the shop as the payer when the returned goods are worth more", () => {
    const rows = refundTotalsSummary({
      isExchange: true,
      totalRefund: 30000,
      totalExchange: 18000,
      difference: 12000,
    })
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ label: "Total Refund", tone: "default" })
    expect(rows[1]).toMatchObject({ label: "Total Pengganti", value: formatRupiah(18000) })
    expect(rows[2].label).toMatch(/^Selisih \(.+\)$/)
    expect(rows[2]).toMatchObject({ value: formatRupiah(12000), tone: "success" })
  })

  it("shows the amount the customer pays as a positive number, with the direction in words", () => {
    const rows = refundTotalsSummary({
      isExchange: true,
      totalRefund: 15000,
      totalExchange: 70000,
      difference: -55000,
    })
    const differenceRow = rows[2]
    expect(differenceRow.value).toBe(formatRupiah(55000))
    expect(differenceRow.tone).toBe("danger")

    const shopPays = refundTotalsSummary({
      isExchange: true,
      totalRefund: 70000,
      totalExchange: 15000,
      difference: 55000,
    })[2]
    // The two directions must read differently, not only by colour.
    expect(differenceRow.label).not.toBe(shopPays.label)
  })

  it("labels an even exchange plainly, without a direction", () => {
    const rows = refundTotalsSummary({
      isExchange: true,
      totalRefund: 15000,
      totalExchange: 15000,
      difference: 0,
    })
    expect(rows[2]).toEqual({ label: "Selisih", value: formatRupiah(0), tone: "strong" })
  })
})

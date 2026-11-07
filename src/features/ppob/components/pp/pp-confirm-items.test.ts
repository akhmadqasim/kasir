import { describe, expect, it } from "vitest"
import { buildPpConfirmItems } from "./pp-confirm-items"
import type { InquiryResult, PpSubMenuItem } from "../../types"

const merchant = { merchant: "PDAM Kota", label: "No. Pelanggan" } as unknown as PpSubMenuItem

function inquiry(over: Partial<InquiryResult> = {}): InquiryResult {
  return { customerName: "Budi", amount: 50000, adminFee: 0, rawData: {}, ...over } as unknown as InquiryResult
}

const base = { groupName: "Air", merchant, paymentCode: "123", vendorCost: 50000, sellPrice: 50000 }
const labels = (items: { label: string }[]) => items.map((i) => i.label)

describe("buildPpConfirmItems", () => {
  it("omits period, admin and markup rows when absent", () => {
    const items = buildPpConfirmItems({ ...base, inquiry: inquiry() })
    expect(labels(items)).not.toContain("Admin")
    expect(items).toHaveLength(6)
    expect(items[2]).toMatchObject({ label: "No. Pelanggan", value: "123", tone: "mono" })
    expect(items.at(-1)).toMatchObject({ label: "Total Bayar", tone: "strong" })
  })

  it("adds admin row when admin fee is positive", () => {
    const items = buildPpConfirmItems({ ...base, inquiry: inquiry({ adminFee: 2500 }) })
    expect(labels(items)).toContain("Admin")
  })

  it("reads period from nested raw data", () => {
    const items = buildPpConfirmItems({ ...base, inquiry: inquiry({ rawData: { data: { periode: "JAN 2026" } } }) })
    expect(items.some((i) => i.value === "JAN 2026")).toBe(true)
  })

  it("adds markup row when sell price exceeds vendor cost", () => {
    const items = buildPpConfirmItems({ ...base, sellPrice: 52000, inquiry: inquiry() })
    expect(items).toHaveLength(7)
  })

  it("falls back to dash for missing group and customer name", () => {
    const items = buildPpConfirmItems({ ...base, groupName: undefined, inquiry: inquiry({ customerName: null as unknown as string }) })
    expect(items[0].value).toBe("-")
    expect(items[3].value).toBe("-")
  })
})

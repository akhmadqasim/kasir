import { describe, expect, it } from "vitest"
import { formatRupiah } from "@/lib/format"
import type { MutasiItem } from "../../types"
import { formatSignedAmount, narrowTopupsToRange, summarizeMutasi } from "./mutasi-utils"

function item(overrides: Partial<MutasiItem> = {}): MutasiItem {
  return {
    id: "1",
    mutationType: "out",
    description: null,
    amount: 1000,
    status: "sukses",
    createdAt: "2026-11-05 10:00:00",
    paymentMethod: null,
    reference: null,
    rawData: {},
    ...overrides,
  }
}

describe("formatSignedAmount", () => {
  it("prefixes + for incoming and - for outgoing", () => {
    expect(formatSignedAmount(item({ mutationType: "in", amount: 5000 }))).toBe(`+${formatRupiah(5000)}`)
    expect(formatSignedAmount(item({ mutationType: "out", amount: 5000 }))).toBe(`-${formatRupiah(5000)}`)
  })

  it("shows a dash when amount is missing", () => {
    expect(formatSignedAmount(item({ mutationType: "in", amount: null }))).toBe("+-")
  })
})

describe("narrowTopupsToRange", () => {
  it("keeps out rows regardless of date", () => {
    const out = item({ mutationType: "out", createdAt: "2020-01-01 00:00:00" })
    expect(narrowTopupsToRange([out], "2026-11-01", "2026-11-07")).toEqual({ items: [out], undatedIn: 0 })
  })

  it("drops in rows outside the range and keeps those inside", () => {
    const inside = item({ id: "a", mutationType: "in", createdAt: "05-11-2026 08:00:00" })
    const outside = item({ id: "b", mutationType: "in", createdAt: "2026-10-01 08:00:00" })
    const result = narrowTopupsToRange([inside, outside], "2026-11-01", "2026-11-07")
    expect(result.items).toEqual([inside])
    expect(result.undatedIn).toBe(0)
  })

  it("keeps and counts undated in rows", () => {
    const undated = item({ mutationType: "in", createdAt: null })
    const garbage = item({ mutationType: "in", createdAt: "not a date" })
    const result = narrowTopupsToRange([undated, garbage], "2026-11-01", "2026-11-07")
    expect(result.items).toHaveLength(2)
    expect(result.undatedIn).toBe(2)
  })
})

describe("summarizeMutasi", () => {
  it("totals only successful movements per direction", () => {
    const summary = summarizeMutasi([
      item({ mutationType: "in", amount: 10000, status: "success" }),
      item({ mutationType: "in", amount: 999, status: "gagal" }),
      item({ mutationType: "out", amount: 2500, status: "Berhasil" }),
      item({ mutationType: "out", amount: null, status: "sukses" }),
      item({ mutationType: "out", amount: 700, status: "pending" }),
    ])
    expect(summary).toEqual({ totalIn: 10000, totalOut: 2500, countIn: 1, countOut: 2 })
  })

  it("returns zeros for an empty list", () => {
    expect(summarizeMutasi([])).toEqual({ totalIn: 0, totalOut: 0, countIn: 0, countOut: 0 })
  })
})

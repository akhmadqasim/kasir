import { describe, expect, it } from "vitest"

import { formatRupiah } from "@/lib/format"
import { buildMutasiDetailRows } from "./components/mutasi/mutasi-detail-rows"
import {
  formatSignedAmount,
  narrowTopupsToRange,
  summarizeMutasi,
} from "./components/mutasi/mutasi-utils"
import type { MutasiItem } from "./types"

function mutasi(overrides: Partial<MutasiItem>): MutasiItem {
  return {
    id: null,
    mutationType: "out",
    description: null,
    amount: 10_000,
    status: "sukses",
    createdAt: "2026-09-10 08:00:00",
    paymentMethod: null,
    reference: null,
    rawData: {},
    ...overrides,
  }
}

describe("narrowTopupsToRange", () => {
  it("narrows topups to the range, keeps payments, and counts undated topups", () => {
    const inside = mutasi({ id: "in-1", mutationType: "in", createdAt: "2026-09-10 08:00:00" })
    const outside = mutasi({ id: "in-2", mutationType: "in", createdAt: "2026-08-01 08:00:00" })
    const undated = mutasi({ id: "in-3", mutationType: "in", createdAt: "bukan tanggal" })
    // The backend already filtered payments; they pass untouched whatever their date.
    const payment = mutasi({ id: "out-1", createdAt: "2026-08-01 08:00:00" })

    const result = narrowTopupsToRange(
      [inside, outside, undated, payment],
      "2026-09-05",
      "2026-09-12",
    )

    expect(result.items.map((item) => item.id)).toEqual(["in-1", "in-3", "out-1"])
    expect(result.undatedIn).toBe(1)
  })
})

describe("summarizeMutasi", () => {
  it("totals each direction, counting only successful movements", () => {
    const summary = summarizeMutasi([
      mutasi({ mutationType: "in", amount: 500_000, status: "success" }),
      mutasi({ mutationType: "in", amount: 100_000, status: "gagal" }),
      mutasi({ mutationType: "out", amount: 20_500 }),
      mutasi({ mutationType: "out", amount: null }),
      mutasi({ mutationType: "out", amount: 9_000, status: "pending" }),
    ])

    expect(summary).toEqual({ totalIn: 500_000, countIn: 1, totalOut: 20_500, countOut: 2 })
  })
})

describe("formatSignedAmount", () => {
  it("signs the amount by direction and dashes a missing one", () => {
    expect(formatSignedAmount(mutasi({ mutationType: "in", amount: 5_000 }))).toBe(
      `+${formatRupiah(5_000)}`,
    )
    expect(formatSignedAmount(mutasi({ amount: null }))).toBe("--")
  })
})

describe("buildMutasiDetailRows", () => {
  it("orders known fields first, hides internal and empty ones, and labels each once", () => {
    const rows = buildMutasiDetailRows({
      zzz_extra: "lain",
      device_id: "dev-1",
      status: "sukses",
      trxid: "TRX-1",
      trx_id: "TRX-1-dup",
      total: "20500",
      fee: "0",
      note: "",
      created_at: "2026-09-10 08:00:00",
    })

    expect(rows).toEqual([
      { label: "Tanggal", value: "2026-09-10 08:00:00" },
      { label: "Total", value: formatRupiah(20_500) },
      { label: "ID Transaksi", value: "TRX-1" },
      { label: "Status", value: "sukses" },
      { label: "Zzz Extra", value: "lain" },
    ])
  })
})

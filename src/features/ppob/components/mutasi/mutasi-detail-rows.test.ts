import { describe, expect, it } from "vitest"
import { formatRupiah } from "@/lib/format"
import { buildMutasiDetailRows } from "./mutasi-detail-rows"

describe("buildMutasiDetailRows", () => {
  it("orders priority keys first, then the rest, and formats money", () => {
    const rows = buildMutasiDetailRows({
      zzz_extra: "x",
      status: "sukses",
      total: "15000",
      product_name: "Pulsa 10K",
    })
    expect(rows).toEqual([
      { label: "Produk", value: "Pulsa 10K" },
      { label: "Total", value: formatRupiah(15000) },
      { label: "Status", value: "sukses" },
      { label: "Zzz Extra", value: "x" },
    ])
  })

  it("drops hidden, empty, zero, dash and object values", () => {
    const rows = buildMutasiDetailRows({
      device_id: "abc",
      note: "",
      fee: 0,
      remark: "-",
      nested: { a: 1 },
      missing: null,
    })
    expect(rows).toEqual([])
  })

  it("shows a shared label only once", () => {
    const rows = buildMutasiDetailRows({ trxid: "T1", trx_id: "T2" })
    expect(rows).toEqual([{ label: "ID Transaksi", value: "T1" }])
  })

  it("keeps a non-numeric money value as-is", () => {
    expect(buildMutasiDetailRows({ amount: "n/a" })).toEqual([{ label: "Nominal", value: "n/a" }])
  })
})

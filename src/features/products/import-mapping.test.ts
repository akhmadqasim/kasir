import { describe, expect, it } from "vitest"

import {
  autoMapColumns,
  fixBarcodeLeadingZero,
  mapImportRows,
  mappedFieldCount,
  missingRequiredFields,
  targetFieldLabel,
  withSkippedRows,
} from "./import-mapping"

describe("autoMapColumns", () => {
  it("mengenali nama kolom umum tanpa peduli huruf besar dan spasi", () => {
    expect(autoMapColumns([" Nama Produk ", "HPP", "Harga", "Pemasok", "Catatan"])).toEqual({
      0: "name",
      1: "buy_price",
      2: "sell_price",
      3: "skip",
    })
  })
})

describe("ringkasan pemetaan", () => {
  it("menghitung kolom yang dipakai, tanpa 'Lewati' dan tanpa duplikat", () => {
    expect(mappedFieldCount({ 0: "name", 1: "skip", 2: "sell_price", 3: "sell_price" })).toBe(2)
  })

  it("menyebut kolom wajib yang belum dipilih", () => {
    expect(missingRequiredFields({})).toEqual(['"Produk (Nama)"', '"Harga Jual"'])
    expect(missingRequiredFields({ 0: "name" })).toEqual(['"Harga Jual"'])
    expect(missingRequiredFields({ 0: "name", 1: "sell_price" })).toEqual([])
  })

  it("memberi label hanya untuk kolom yang benar-benar dipetakan", () => {
    expect(targetFieldLabel("sell_price")).toBe("Harga Jual")
    expect(targetFieldLabel("skip")).toBeNull()
    expect(targetFieldLabel(undefined)).toBeNull()
  })
})

describe("fixBarcodeLeadingZero", () => {
  it("mengembalikan nol di depan yang dibuang Excel bila check digit-nya cocok", () => {
    // UPC-A 012345678905 tersimpan sebagai angka 12345678905.
    expect(fixBarcodeLeadingZero("12345678905")).toBe("012345678905")
  })

  it("membiarkan kode yang panjangnya sudah standar atau bukan angka", () => {
    expect(fixBarcodeLeadingZero("8991234567890")).toBe("8991234567890")
    expect(fixBarcodeLeadingZero("ABC123")).toBe("ABC123")
    expect(fixBarcodeLeadingZero("")).toBe("")
  })

  it("tidak menambah nol bila check digit hasilnya tidak cocok", () => {
    expect(fixBarcodeLeadingZero("12345678901")).toBe("12345678901")
  })
})

describe("mapImportRows", () => {
  const columnMap = { 0: "name", 1: "sell_price", 2: "stock", 3: "skip" } as const

  it("mengubah baris menjadi input produk dengan angka format Indonesia", () => {
    const { products, skippedRowNumbers } = mapImportRows(
      [["Kopi Sachet", "1.500", "10", "abaikan"]],
      columnMap,
    )
    expect(skippedRowNumbers).toEqual([])
    expect(products).toEqual([
      {
        name: "Kopi Sachet",
        barcode: undefined,
        category_name: undefined,
        buy_price: 0,
        sell_price: 1500,
        margin: 0,
        stock: 10,
        unit: "pcs",
      },
    ])
  })

  it("melewati baris tanpa nama dan mencatat nomor barisnya", () => {
    const { products, skippedRowNumbers } = mapImportRows(
      [
        ["Gula", "15000", "5"],
        ["", "2000", "1"],
        ["Teh", "3000", "2"],
      ],
      columnMap,
    )
    expect(products.map((p) => p.name)).toEqual(["Gula", "Teh"])
    expect(skippedRowNumbers).toEqual([2])
  })
})

describe("withSkippedRows", () => {
  const result = { imported: 3, updated: 1, skipped: 2, errors: ["baris 4: harga kosong"] }

  it("tidak mengubah hasil bila tidak ada baris yang dilewati di sisi klien", () => {
    expect(withSkippedRows(result, [])).toBe(result)
  })

  it("menjumlahkan baris yang dilewati dan menyebut nomornya", () => {
    const rows = Array.from({ length: 12 }, (_, i) => i + 1)
    expect(withSkippedRows(result, rows)).toEqual({
      imported: 3,
      updated: 1,
      skipped: 14,
      errors: [
        "baris 4: harga kosong",
        "12 baris dilewati karena kolom nama kosong (baris 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 dan 2 lainnya)",
      ],
    })
  })
})

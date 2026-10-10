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

  it("mengembalikan nol EAN-8 yang dibuang (7 digit)", () => {
    expect(fixBarcodeLeadingZero("1234565")).toBe("01234565")
  })

  it("tidak pernah menambah lebih dari satu nol pada kode internal pendek", () => {
    // "00123457" passes the EAN-8 check digit, but "123457" is a shop code.
    expect(fixBarcodeLeadingZero("123457")).toBe("123457")
    // "000012345670" passes the UPC-A check digit.
    expect(fixBarcodeLeadingZero("12345670")).toBe("12345670")
  })

  it("membiarkan 12 digit apa adanya, karena itu UPC-A yang sah", () => {
    expect(fixBarcodeLeadingZero("123456789012")).toBe("123456789012")
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
    expect(products).toEqual([{ name: "Kopi Sachet", sell_price: 1500, stock: 10, row_number: 1 }])
  })

  it("hanya mengirim kolom yang dipetakan dan terisi", () => {
    // A file of prices only must not send stock 0, cost 0, unit "pcs" — the
    // backend would overwrite the matching product's data with those values.
    const priceOnly = mapImportRows([["Gula", "16.000"]], { 0: "name", 1: "sell_price" })
    expect(priceOnly.products).toEqual([{ name: "Gula", sell_price: 16000, row_number: 1 }])

    const full = {
      0: "name",
      1: "barcode",
      2: "category_name",
      3: "buy_price",
      4: "margin",
      5: "sell_price",
      6: "stock",
      7: "unit",
    } as const
    const { products } = mapImportRows(
      [
        ["Beras", "8991234567890", "Sembako", "12.000", "10", "13.200", "0", "kg"],
        ["Teh", "", " ", "", "", "3.000", "", ""],
      ],
      full,
    )
    expect(products).toEqual([
      {
        name: "Beras",
        barcode: "8991234567890",
        category_name: "Sembako",
        buy_price: 12000,
        margin: 10,
        sell_price: 13200,
        stock: 0,
        unit: "kg",
        row_number: 1,
      },
      { name: "Teh", sell_price: 3000, row_number: 2 },
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
    // Each product keeps its own data-row number, so backend errors match the preview.
    expect(products.map((p) => p.row_number)).toEqual([1, 3])
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

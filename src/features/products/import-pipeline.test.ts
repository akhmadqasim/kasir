import { describe, expect, it } from "vitest"
import { utils, write } from "xlsx"

import { autoMapColumns, mapImportRows, missingRequiredFields } from "./import-mapping"
import { readSheetRows } from "./import-sheet"

/**
 * The whole import path a file takes before it reaches the backend: read the sheet,
 * guess the columns, turn rows into products. The unit tests of each step use
 * hand-written inputs; these feed each step what the previous one really produces.
 */

function csv(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

function workbook(rows: unknown[][], format?: (ws: ReturnType<typeof utils.aoa_to_sheet>) => void) {
  const ws = utils.aoa_to_sheet(rows)
  format?.(ws)
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, "Produk")
  return write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
}

function importFile(data: ArrayBuffer) {
  const { headers, rows, percentCells } = readSheetRows(data)
  const columnMap = autoMapColumns(headers)
  return { headers, columnMap, ...mapImportRows(rows, columnMap, percentCells) }
}

describe("product import, file to products", () => {
  it("reads an Indonesian price list CSV into exact rupiah prices", () => {
    const { products, skippedRowNumbers } = importFile(
      csv(
        "Nama Produk,Barcode,Harga Beli,Harga Jual,Stok,Satuan\n" +
          'Gula Pasir 1kg,8991002101036,"14.000","Rp 16.500,-",1.000,kg\n' +
          'Kopi Sachet,,"1.250,50",1500,24,pcs\n',
      ),
    )

    expect(skippedRowNumbers).toEqual([])
    expect(products).toEqual([
      {
        name: "Gula Pasir 1kg",
        barcode: "8991002101036",
        buy_price: 14000,
        sell_price: 16500,
        stock: 1000,
        unit: "kg",
        row_number: 1,
      },
      {
        name: "Kopi Sachet",
        buy_price: 1250.5,
        sell_price: 1500,
        stock: 24,
        unit: "pcs",
        row_number: 2,
      },
    ])
  })

  it("recognises the header row of a CSV saved with a UTF-8 byte order mark", () => {
    // Excel's "CSV UTF-8" export starts the file with U+FEFF.
    const { headers, columnMap } = importFile(
      csv("﻿Nama Produk,Harga Jual,Stok\nKopi Sachet,1500,10\n"),
    )
    expect(headers[0]).toBe("Nama Produk")
    expect(missingRequiredFields(columnMap)).toEqual([])
  })

  it("splits a semicolon-separated CSV, which Excel writes on Indonesian Windows", () => {
    // With "," as the decimal mark, Excel id-ID saves CSV with ";" between cells.
    const { headers, products } = importFile(
      csv("Nama Produk;Harga Jual;Stok\nKopi Sachet;1.500;10\nTeh;2.500,50;3\n"),
    )
    expect(headers).toEqual(["Nama Produk", "Harga Jual", "Stok"])
    expect(products).toEqual([
      { name: "Kopi Sachet", sell_price: 1500, stock: 10, row_number: 1 },
      { name: "Teh", sell_price: 2500.5, stock: 3, row_number: 2 },
    ])
  })

  it("keeps the fraction of an Excel price cell", () => {
    const { products } = importFile(
      workbook([
        ["Nama Produk", "Harga Jual", "Stok"],
        ["Minyak Curah", 15750.5, 7],
      ]),
    )
    expect(products).toEqual([
      { name: "Minyak Curah", sell_price: 15750.5, stock: 7, row_number: 1 },
    ])
  })

  it("reads a thousands-formatted Excel stock count as the whole number", () => {
    const { products } = importFile(
      workbook(
        [
          ["Nama Produk", "Harga Jual", "Stok"],
          ["Air Mineral", 3000, 1200],
        ],
        (ws) => {
          ws.C2.z = "#,##0"
        },
      ),
    )
    expect(products[0].stock).toBe(1200)
  })

  // An Excel percent cell holds the fraction (0.125) and shows "12.5%". The margin
  // must come out as the percent shown, not 0.125 %.
  it("reads a percent-formatted Excel margin cell as the percent shown", () => {
    const { products } = importFile(
      workbook(
        [
          ["Nama Produk", "Harga Jual", "Margin (%)"],
          ["Gula Pasir 1kg", 16000, 0.125],
        ],
        (ws) => {
          ws.C2.z = "0.0%"
        },
      ),
    )
    expect(products[0].margin).toBe(12.5)
  })

  // `0.0"%"` (like `0.0\%`) only prints a "%" after the number: Excel stores 12.5
  // there, so scaling it by 100 imported a 1250 % margin.
  it("reads a margin cell with a literal % in its format as the number stored", () => {
    const { products } = importFile(
      workbook(
        [
          ["Nama Produk", "Harga Jual", "Margin (%)"],
          ["Gula Pasir 1kg", 16000, 12.5],
        ],
        (ws) => {
          ws.C2.z = '0.0"%"'
        },
      ),
    )
    expect(products[0].margin).toBe(12.5)
  })

  // Percent scaling is for the margin only: a percent-formatted price or stock
  // cell holds its value as Excel stores it.
  it("does not scale a percent-formatted cell mapped to another column", () => {
    const { products } = importFile(
      workbook(
        [
          ["Nama Produk", "Harga Jual", "Stok", "Margin (%)"],
          ["Gula Pasir 1kg", 16000, 12, 0.07],
        ],
        (ws) => {
          ws.C2.z = "0%"
          ws.D2.z = "0%"
        },
      ),
    )
    expect(products[0].stock).toBe(12)
    expect(products[0].margin).toBe(7)
  })

  it("reports the file's own row numbers for rows without a name", () => {
    const { products, skippedRowNumbers } = importFile(
      csv("Judul daftar harga,,\nNama Produk,Harga Jual,Stok\nKopi,1500,1\n,2000,1\nTeh,3000,1\n"),
    )
    expect(products.map((p) => p.name)).toEqual(["Kopi", "Teh"])
    // Data row 2 (below the header), as the preview numbers it.
    expect(skippedRowNumbers).toEqual([2])
  })

  // `mapImportRows` drops nameless rows before sending, so `bulk_create` must not
  // number its errors by array index. Each product carries its file data-row number
  // (`row_number`), which the backend uses in its "Baris N" messages.
  // Repro: rows [Kopi, <no name>, Teh with price 0] → Teh is data row 3, not 2.
  it("a row the backend rejects is numbered the same as in the preview", () => {
    const { products, skippedRowNumbers } = importFile(
      csv("Nama Produk,Harga Jual\nKopi,1500\n,2000\nTeh,0\n"),
    )
    expect(skippedRowNumbers).toEqual([2])
    // What `bulk_create` calls the row it rejects for the zero price.
    const backendRowNumber = products.find((p) => p.name === "Teh")?.row_number
    expect(backendRowNumber).toBe(3)
  })
})

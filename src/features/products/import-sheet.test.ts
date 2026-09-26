import { describe, expect, it } from "vitest"
import { utils, write } from "xlsx"

import { ImportSheetError, readSheetRows } from "./import-sheet"

function csv(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

describe("readSheetRows", () => {
  it("melewati baris judul di atas header dan membuang baris kosong", () => {
    const sheet = readSheetRows(
      csv(
        "Daftar Harga Toko,,\nNama Produk,Harga Jual,Stok\nKopi Sachet,1500,10\n,,\nTeh,3000,2\n",
      ),
    )
    expect(sheet.headers).toEqual(["Nama Produk", "Harga Jual", "Stok"])
    expect(sheet.rows).toEqual([
      ["Kopi Sachet", "1500", "10"],
      ["Teh", "3000", "2"],
    ])
  })

  // SheetJS menebak angka di CSV dengan aturan en-US: "1.500" jadi 1,5.
  // Teks aslinya yang harus sampai ke parser angka Indonesia.
  it("membiarkan angka CSV apa adanya, termasuk titik ribuan dan nol di depan", () => {
    const sheet = readSheetRows(
      csv('Nama Produk,Harga Jual,Barcode\nKopi Sachet,1.500,0012345678905\nTeh,"2.500,50",12\n'),
    )
    expect(sheet.rows).toEqual([
      ["Kopi Sachet", "1.500", "0012345678905"],
      ["Teh", "2.500,50", "12"],
    ])
  })

  // Di workbook, angka sel adalah angka sungguhan; teks berformat `#,##0` ("12,000")
  // akan dibaca parser Indonesia sebagai 12.
  it("memakai nilai angka sel Excel, bukan teks berformatnya", () => {
    const ws = utils.aoa_to_sheet([
      ["Nama Produk", "Harga Jual", "Barcode"],
      ["Kopi Sachet", 12000, 12345678905],
    ])
    ws.B2.z = "#,##0"
    ws.C2.z = "0000000000000"
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, "Produk")
    const data = write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer

    expect(readSheetRows(data).rows).toEqual([["Kopi Sachet", "12000", "0012345678905"]])
  })

  it("menolak file yang hanya berisi header", () => {
    expect(() => readSheetRows(csv("Nama Produk,Harga Jual\n"))).toThrow(ImportSheetError)
  })
})

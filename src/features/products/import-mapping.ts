import { parseIndonesianInteger, parseIndonesianNumber } from "@/lib/format"
import type { PercentCells } from "./import-sheet"
import type { BulkImportResult, BulkProductInput } from "./types"

/**
 * Column mapping for the product import: which file column feeds which product
 * field, and turning the mapped rows into `bulk_create_products` input.
 */

export const TARGET_FIELDS = [
  { key: "skip", label: "-- Lewati --" },
  { key: "name", label: "Produk (Nama)" },
  { key: "barcode", label: "Barcode" },
  { key: "category_name", label: "Kategori" },
  { key: "buy_price", label: "HPP (Harga Beli)" },
  { key: "margin", label: "Margin (%)" },
  { key: "sell_price", label: "Harga Jual" },
  { key: "stock", label: "Stok" },
  { key: "unit", label: "Satuan" },
] as const

export type TargetFieldKey = (typeof TARGET_FIELDS)[number]["key"]

/** File column index → the product field it feeds. */
export type ColumnMap = Record<number, TargetFieldKey>

const COLUMN_MAPPING: Record<string, TargetFieldKey> = {
  nama: "name",
  "nama produk": "name",
  produk: "name",
  product: "name",
  name: "name",
  barcode: "barcode",
  kategori: "category_name",
  "kategori produk": "category_name",
  category: "category_name",
  "harga beli": "buy_price",
  "harga modal": "buy_price",
  hpp: "buy_price",
  "buy price": "buy_price",
  cost: "buy_price",
  "harga jual": "sell_price",
  harga: "sell_price",
  "sell price": "sell_price",
  price: "sell_price",
  stok: "stock",
  stock: "stock",
  satuan: "unit",
  unit: "unit",
  no: "skip",
  toko: "skip",
  pemasok: "skip",
  supplier: "skip",
  margin: "margin",
  "margin (%)": "margin",
}

export function autoMapColumns(headers: string[]): ColumnMap {
  const result: ColumnMap = {}
  headers.forEach((header, idx) => {
    const match = COLUMN_MAPPING[header.trim().toLowerCase()]
    if (match) result[idx] = match
  })
  return result
}

export function targetFieldLabel(key: TargetFieldKey | undefined): string | null {
  if (key == null || key === "skip") return null
  return TARGET_FIELDS.find((field) => field.key === key)?.label ?? null
}

/** How many distinct product fields the mapping fills. */
export function mappedFieldCount(columnMap: ColumnMap): number {
  return new Set(Object.values(columnMap).filter((field) => field !== "skip")).size
}

/** The fields an import cannot start without, as quoted labels, in display order. */
export function missingRequiredFields(columnMap: ColumnMap): string[] {
  const mapped = Object.values(columnMap)
  return [
    !mapped.includes("name") && '"Produk (Nama)"',
    !mapped.includes("sell_price") && '"Harga Jual"',
  ].filter((label): label is string => Boolean(label))
}

/** Validate EAN/UPC check digit for a barcode string of 8, 12, or 13 digits */
function isValidCheckDigit(code: string): boolean {
  if (!/^\d+$/.test(code)) return false
  const len = code.length
  if (len !== 8 && len !== 12 && len !== 13) return false
  const digits = code.split("").map(Number)
  const check = digits.pop()!
  const sum = digits.reduce((acc, d, i) => {
    const weight = len === 13 ? (i % 2 === 0 ? 1 : 3) : i % 2 === 0 ? 3 : 1
    return acc + d * weight
  }, 0)
  return (10 - (sum % 10)) % 10 === check
}

/** Restores the one zero Excel drops (7 → EAN-8, 11 → UPC-A) if the check digit holds. */
export function fixBarcodeLeadingZero(value: string): string {
  if (!value || !/^\d+$/.test(value)) return value
  if (value.startsWith("0")) return value
  if (value.length !== 7 && value.length !== 11) return value
  const padded = `0${value}`
  return isValidCheckDigit(padded) ? padded : value
}

export interface MappedRows {
  products: BulkProductInput[]
  /** 1-based positions of data rows dropped before the backend ever sees them. */
  skippedRowNumbers: number[]
}

/**
 * `percentCells` are the sheet's Excel percent cells (`SheetRows.percentCells`),
 * whose text is the percent shown. That is the value only for the margin, which
 * is a percent; any other column takes the fraction the cell holds.
 */
export function mapImportRows(
  rows: string[][],
  columnMap: ColumnMap,
  percentCells: PercentCells = new Map(),
): MappedRows {
  const products: BulkProductInput[] = []
  const skippedRowNumbers: number[] = []

  rows.forEach((row, rowIdx) => {
    const product: Partial<Record<TargetFieldKey, string>> = {}
    const rowPercents = percentCells.get(rowIdx)
    Object.entries(columnMap).forEach(([colIdxStr, field]) => {
      if (field === "skip") return
      const colIdx = parseInt(colIdxStr, 10)
      const fraction = rowPercents?.get(colIdx)
      product[field] =
        fraction !== undefined && field !== "margin"
          ? String(fraction).replace(".", ",")
          : String(row[colIdx] ?? "").trim()
    })

    if (!product.name) {
      // Row numbers are 1-based and relative to the data rows shown in the preview.
      skippedRowNumbers.push(rowIdx + 1)
      return
    }

    // Unmapped columns and blank cells are left out, not zeroed (see `BulkProductInput`).
    const input: BulkProductInput = {
      name: product.name,
      sell_price: parseIndonesianNumber(product.sell_price) ?? 0,
      row_number: rowIdx + 1,
    }
    const barcode = fixBarcodeLeadingZero(product.barcode ?? "")
    if (barcode) input.barcode = barcode
    if (product.category_name) input.category_name = product.category_name
    const buyPrice = parseIndonesianNumber(product.buy_price)
    if (buyPrice != null) input.buy_price = buyPrice
    const margin = parseIndonesianNumber(product.margin)
    if (margin != null) input.margin = margin
    const stock = parseIndonesianInteger(product.stock)
    if (stock != null) input.stock = stock
    if (product.unit) input.unit = product.unit
    products.push(input)
  })

  return { products, skippedRowNumbers }
}

/** "3, 7, 12 dan 4 lainnya" — keeps the warning readable for large files. */
function formatRowList(rowNumbers: number[], limit = 10): string {
  const shown = rowNumbers.slice(0, limit).join(", ")
  const rest = rowNumbers.length - limit
  return rest > 0 ? `${shown} dan ${rest} lainnya` : shown
}

/**
 * Rows dropped here never reach the backend, so its counters cannot see them.
 * Fold them in so the totals add up to the number of rows in the file.
 */
export function withSkippedRows(
  result: BulkImportResult,
  skippedRowNumbers: number[],
): BulkImportResult {
  if (skippedRowNumbers.length === 0) return result
  return {
    ...result,
    skipped: result.skipped + skippedRowNumbers.length,
    errors: [
      ...result.errors,
      `${skippedRowNumbers.length} baris dilewati karena kolom nama kosong (baris ${formatRowList(skippedRowNumbers)})`,
    ],
  }
}

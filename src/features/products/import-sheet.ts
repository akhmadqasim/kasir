import { read, utils, type WorkSheet } from "xlsx"
import { id } from "@/i18n/id"

/** A file that parsed but holds nothing importable; `message` is shown as-is. */
export class ImportSheetError extends Error {}

export interface SheetRows {
  headers: string[]
  /** Data rows below the header, blank rows removed. */
  rows: string[][]
}

const KNOWN_HEADERS = ["produk", "barcode", "harga", "stok", "nama", "nama produk", "hpp"]

/** The sheet with the most rows — price lists often carry a cover or notes sheet first. */
function pickSheet(sheets: Record<string, WorkSheet>, names: string[]): WorkSheet {
  let bestSheet = names[0]
  let bestRowCount = 0
  for (const name of names) {
    const rows: unknown[][] = utils.sheet_to_json(sheets[name], { header: 1 })
    if (rows.length > bestRowCount) {
      bestRowCount = rows.length
      bestSheet = name
    }
  }
  return sheets[bestSheet]
}

/** Read cells directly to properly handle barcodes with leading zeros. */
function sheetToStringRows(sheet: WorkSheet): string[][] {
  const ref = sheet["!ref"]
  if (!ref) throw new ImportSheetError(id.products.sheetEmpty)

  const range = utils.decode_range(ref)
  const stringRows: string[][] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[utils.encode_cell({ r, c })]
      if (!cell) {
        row.push("")
      } else if (cell.t === "s") {
        // Text cell — preserves leading zeros
        row.push(String(cell.v ?? "").trim())
      } else if (cell.t === "n") {
        // Number cell. The formatted text is kept only when it is the same
        // integer with leading zeros (a barcode formatted "0000000000000").
        // Anything else — "12,000" from `#,##0`, "Rp12,000", a rounded "13" —
        // would be misread by the Indonesian parser (a lone comma is a decimal
        // mark there), so emit the raw value with a comma decimal mark instead.
        const num = cell.v as number
        const w = (cell.w as string | undefined)?.trim()
        if (w && /^\d+$/.test(w) && Number(w) === num) {
          row.push(w)
        } else {
          row.push(Number.isFinite(num) ? String(num).replace(".", ",") : String(num))
        }
      } else {
        row.push(String(cell.w ?? cell.v ?? "").trim())
      }
    }
    stringRows.push(row)
  }
  return stringRows
}

/** Auto-detect header row by looking for known column names in the first ten rows. */
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const matchCount = rows[i].filter((c) => KNOWN_HEADERS.includes(c.toLowerCase())).length
    if (matchCount >= 2) return i
  }
  return 0
}

/**
 * Parse an uploaded CSV/Excel file into a header row and its data rows.
 * Throws {@link ImportSheetError} when the file holds nothing to import.
 */
export function readSheetRows(data: ArrayBuffer): SheetRows {
  // `raw`: a CSV/TSV cell stays the text the file holds. Left to guess, SheetJS
  // reads "1.500" (Indonesian thousands) as 1.5 and the price comes out a
  // thousand times too small; the text goes to the Indonesian parser instead.
  // Binary workbooks are unaffected — their number cells are real numbers.
  const workbook = read(new Uint8Array(data), { type: "array", raw: true })
  const stringRows = sheetToStringRows(pickSheet(workbook.Sheets, workbook.SheetNames))

  const headerRowIdx = findHeaderRow(stringRows)
  if (stringRows.length <= headerRowIdx + 1) {
    throw new ImportSheetError(id.products.fileEmptyOrInvalid)
  }

  const headers = stringRows[headerRowIdx].map((h) => String(h || "").trim())
  const rows = stringRows
    .slice(headerRowIdx + 1)
    .filter((row) => row.some((cell) => String(cell).trim() !== ""))
  if (rows.length === 0) throw new ImportSheetError(id.products.noProductRows)

  return { headers, rows }
}

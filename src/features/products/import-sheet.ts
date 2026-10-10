import { read, utils, type WorkSheet } from "xlsx"
import { id } from "@/i18n/id"

/** A file that parsed but holds nothing importable; `message` is shown as-is. */
export class ImportSheetError extends Error {}

/**
 * The Excel percent cells of the data rows: row index (into `rows`) → column
 * index → the fraction the cell holds (0.125 for a cell shown "12.5%").
 */
export type PercentCells = ReadonlyMap<number, ReadonlyMap<number, number>>

export interface SheetRows {
  headers: string[]
  /** Data rows below the header, blank rows removed. */
  rows: string[][]
  /**
   * Cells formatted as a real percent. Their text in `rows` is the percent
   * shown ("12,5%"); whether that or the fraction is the value depends on the
   * column it is mapped to, which only the mapping knows (`mapImportRows`).
   */
  percentCells: PercentCells
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

/**
 * Whether an Excel number format multiplies by 100: a `%` that is a format
 * code, not literal text. `0.0"%"` and `0.0\%` only print a percent sign after
 * the stored number (12.5 shows "12.5%"); `0.0%` stores 0.125 for the same
 * text. Quoted text, escaped and padding characters, and `[...]` sections
 * (colours, conditions, locales) are skipped.
 */
export function isPercentFormat(format: string): boolean {
  for (let i = 0; i < format.length; i++) {
    const ch = format[i]
    if (ch === '"') {
      const end = format.indexOf('"', i + 1)
      if (end < 0) return false
      i = end
    } else if (ch === "\\" || ch === "_" || ch === "*") {
      i++
    } else if (ch === "[") {
      const end = format.indexOf("]", i + 1)
      if (end < 0) return false
      i = end
    } else if (ch === "%") {
      return true
    }
  }
  return false
}

interface StringRows {
  rows: string[][]
  /** Per row, the percent cells' fractions by column; `undefined` for a row without any. */
  percents: (Map<number, number> | undefined)[]
}

/** Read cells directly to properly handle barcodes with leading zeros. */
function sheetToStringRows(sheet: WorkSheet): StringRows {
  const ref = sheet["!ref"]
  if (!ref) throw new ImportSheetError(id.products.sheetEmpty)

  const range = utils.decode_range(ref)
  const stringRows: string[][] = []
  const percents: (Map<number, number> | undefined)[] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = []
    let rowPercents: Map<number, number> | undefined
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
        //
        // A real percent cell holds the fraction (0.125) but shows "12.5%":
        // its text is the percent shown, and the fraction is kept aside for a
        // column that is not a percent (see `SheetRows.percentCells`).
        const raw = cell.v as number
        const w = (cell.w as string | undefined)?.trim()
        if (Number.isFinite(raw) && isPercentFormat(String(cell.z ?? ""))) {
          rowPercents ??= new Map()
          rowPercents.set(c - range.s.c, raw)
          row.push(`${String(percentShown(raw)).replace(".", ",")}%`)
        } else if (w && /^\d+$/.test(w) && Number(w) === raw) {
          row.push(w)
        } else {
          row.push(Number.isFinite(raw) ? String(raw).replace(".", ",") : String(raw))
        }
      } else {
        row.push(String(cell.w ?? cell.v ?? "").trim())
      }
    }
    stringRows.push(row)
    percents.push(rowPercents)
  }
  return { rows: stringRows, percents }
}

/** The percent a fraction shows; `toPrecision` drops noise such as 0.07 * 100 = 7.000000000000001. */
export function percentShown(fraction: number): number {
  return Number((fraction * 100).toPrecision(15))
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
  // `cellNF`: keep each cell's number format, the only way to tell a real
  // percent from a literal "%" (see `isPercentFormat`).
  const workbook = read(new Uint8Array(data), { type: "array", raw: true, cellNF: true })
  const { rows: stringRows, percents } = sheetToStringRows(
    pickSheet(workbook.Sheets, workbook.SheetNames),
  )

  const headerRowIdx = findHeaderRow(stringRows)
  if (stringRows.length <= headerRowIdx + 1) {
    throw new ImportSheetError(id.products.fileEmptyOrInvalid)
  }

  const headers = stringRows[headerRowIdx].map((h) => String(h || "").trim())
  const rows: string[][] = []
  const percentCells = new Map<number, ReadonlyMap<number, number>>()
  for (let r = headerRowIdx + 1; r < stringRows.length; r++) {
    const row = stringRows[r]
    if (!row.some((cell) => String(cell).trim() !== "")) continue
    const rowPercents = percents[r]
    if (rowPercents) percentCells.set(rows.length, rowPercents)
    rows.push(row)
  }
  if (rows.length === 0) throw new ImportSheetError(id.products.noProductRows)

  return { headers, rows, percentCells }
}

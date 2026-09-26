// Copied from the desktop's `src/lib/format.ts`. Pure `Intl`, no DOM.
//
// On React Native this relies on Hermes shipping `Intl` with the `id-ID`
// locale data, which it does on both iOS and Android for SDK 50+.

const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** `Rp 150.000`, no decimals. */
export function formatRupiah(amount: number): string {
  return rupiahFormatter.format(amount)
}

const numberFormatter = new Intl.NumberFormat("id-ID")

/** Whole numbers with Indonesian thousands separators: `1.234`. */
export function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

/**
 * Parse a number written with Indonesian conventions (`.` groups thousands, `,` marks
 * decimals) as well as plain and English-formatted input. Returns `null` when the value
 * holds no number at all, so callers decide what an empty field means.
 *
 * Separator rules, in order:
 *  1. Both separators present — the right-most one is the decimal mark.
 *     `"1.234,56"` is 1234.56 and `"2,500.75"` is 2500.75.
 *  2. Only commas — repeated commas can only group thousands (`"1,234,567"` is 1234567);
 *     a single comma is the Indonesian decimal mark (`"2500,5"` is 2500.5).
 *  3. Only dots — repeated dots group thousands (`"1.234.567"` is 1234567); a single dot
 *     groups thousands when exactly three digits follow it, otherwise it is a decimal
 *     point (`"14.5"` is 14.5).
 *
 * The deliberate call on genuinely ambiguous input is rule 3: **`"1.234"` reads as 1234**,
 * not 1.234. In a rupiah price list three digits after a dot is a thousands group.
 */
export function parseIndonesianNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (value === null || value === undefined) return null

  const raw = String(value).trim()
  if (!raw) return null

  const isNegative = /^\(.*\)$/.test(raw) || /^[^\d]*-/.test(raw)

  // Drop currency symbols, spaces and signs, then the trailing separators of the
  // Indonesian "Rp 14.000,-" shorthand.
  const body = raw.replace(/[^\d.,]/g, "").replace(/[.,]+$/, "")
  if (!/\d/.test(body)) return null

  const firstComma = body.indexOf(",")
  const lastComma = body.lastIndexOf(",")
  const lastDot = body.lastIndexOf(".")

  let normalized: string
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSeparator = lastDot > lastComma ? "." : ","
    const groupSeparator = decimalSeparator === "." ? "," : "."
    normalized = body.split(groupSeparator).join("").replace(decimalSeparator, ".")
  } else if (lastComma >= 0) {
    normalized = firstComma === lastComma ? body.replace(",", ".") : body.split(",").join("")
  } else if (lastDot >= 0) {
    const groups = body.split(".")
    const lastGroup = groups[groups.length - 1]
    normalized = groups.length > 2 || lastGroup.length === 3 ? groups.join("") : body
  } else {
    normalized = body
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return isNegative ? -Math.abs(parsed) : parsed
}

/** {@link parseIndonesianNumber} truncated toward zero, for integer fields like stock. */
export function parseIndonesianInteger(value: unknown): number | null {
  const parsed = parseIndonesianNumber(value)
  return parsed === null ? null : Math.trunc(parsed)
}

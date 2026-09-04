const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export function formatRupiah(amount: number): string {
  return rupiahFormatter.format(amount)
}

/**
 * Parse a number written with Indonesian conventions (`.` groups thousands, `,` marks
 * decimals) as well as plain and English-formatted input. Returns `null` when the value
 * holds no number at all, so callers decide what an empty cell means.
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
 * not 1.234. In a rupiah price list three digits after a dot is a thousands group, prices
 * carry no fractional rupiah, and the two readings fail very differently — reading
 * `"14.000"` as 14 silently destroys the price catalogue, while over-reading a real
 * decimal shows up immediately as an absurd price.
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
    normalized =
      firstComma === lastComma ? body.replace(",", ".") : body.split(",").join("")
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

/** {@link parseIndonesianNumber} truncated toward zero, for integer columns like stock. */
export function parseIndonesianInteger(value: unknown): number | null {
  const parsed = parseIndonesianNumber(value)
  return parsed === null ? null : Math.trunc(parsed)
}

const BACKEND_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/
const EXPLICIT_TIMEZONE = /([zZ]|[+-]\d{2}:?\d{2})$/

/**
 * Turn a timestamp coming from the Rust backend into a `Date`.
 *
 * SQLite hands back UTC timestamps shaped `"YYYY-MM-DD HH:MM:SS"`, which is not
 * ISO-8601. `new Date(str)` therefore reads it as *local* time and every rendered date
 * drifts by the UTC offset — seven hours in WIB, enough to print the wrong calendar day
 * for anything sold before 07:00 local. Appending `Z` pins the string to UTC so the
 * displayed day matches the day the backend filed the row under.
 */
export function parseBackendDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null

  const normalized =
    BACKEND_TIMESTAMP.test(trimmed) && !EXPLICIT_TIMEZONE.test(trimmed)
      ? `${trimmed.replace(" ", "T")}Z`
      : trimmed

  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

const dateTimeFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

const dayDateFormatter = new Intl.DateTimeFormat("id-ID", {
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
})

/** "05 Sep 2026 01.00" — backend timestamp with time of day, in the local timezone. */
export function formatDateTime(
  value: string | null | undefined,
  fallback = "—"
): string {
  const date = parseBackendDate(value)
  return date ? dateTimeFormatter.format(date) : fallback
}

/** "Sab, 6 Sep 2026" — backend timestamp as a calendar day, in the local timezone. */
export function formatDayDate(
  value: string | null | undefined,
  fallback = "—"
): string {
  const date = parseBackendDate(value)
  return date ? dayDateFormatter.format(date) : fallback
}

/**
 * "YYYY-MM-DD" for the *local* calendar day, the shape every date-range filter expects.
 * `toISOString().slice(0, 10)` would answer with the UTC day, which is yesterday for any
 * local time before 07:00 in WIB.
 */
export function toLocalDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

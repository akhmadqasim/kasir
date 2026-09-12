import type { StatusVariant } from "@/components/status-badge"
import { formatRupiah } from "@/lib/format"

const groupFormatter = new Intl.NumberFormat("id-ID")

/**
 * Cash is typed, not stepped: the kasir reads notes out of the drawer and types
 * the total. `NumberField` would commit on blur and bind the arrow keys to
 * ±1 rupiah, so the cash fields stay text inputs that keep only the digits and
 * regroup them on every keystroke — exactly what they did before the migration.
 */
export function toDigits(value: string): string {
  const digits = value.replace(/\D/g, "")
  return digits === "" ? "" : String(Number(digits))
}

/** The grouped form shown in the input, e.g. `"50000"` -> `"50.000"`. */
export function groupDigits(digits: string): string {
  return digits === "" ? "" : groupFormatter.format(Number(digits))
}

/** Rupiah with an explicit `+` on the positive side, for balances that can go either way. */
export function signedRupiah(amount: number): string {
  return `${amount >= 0 ? "+" : ""}${formatRupiah(amount)}`
}

/**
 * A drawer short by more than a rupiah is the only case worth colouring red; a
 * rounding-level gap reads as "matched", and a surplus is worth noticing but is
 * not an error.
 */
export function cashDifferenceStatus(difference: number): StatusVariant {
  if (Math.abs(difference) < 1) return "neutral"
  return difference < 0 ? "error" : "info"
}

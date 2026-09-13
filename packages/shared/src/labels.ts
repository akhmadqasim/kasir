import { formatNumber, formatRupiah } from "./format"
import { id } from "./i18n/id"
import type { User } from "./types/auth"
import type { WriteoffReason } from "./types/stock"
import { WRITEOFF_REASONS } from "./types/stock"

/**
 * Labels that map a backend vocabulary word to what the screen prints.
 * Unknown values are shown as they are, never hidden — the same rule as the
 * desktop's `src/lib/labels.ts`.
 */

export const WRITEOFF_REASON_LABELS: Record<WriteoffReason, string> = {
  damaged: id.stock.reasons.damaged,
  expired: id.stock.reasons.expired,
  lost: id.stock.reasons.lost,
  other: id.stock.reasons.other,
}

export function writeoffReasonLabel(reason: string): string {
  return (WRITEOFF_REASON_LABELS as Record<string, string>)[reason] ?? reason
}

export function isWriteoffReason(value: string): value is WriteoffReason {
  return (WRITEOFF_REASONS as readonly string[]).includes(value)
}

export const ROLE_LABELS: Record<User["role"], string> = {
  admin: id.roles.admin,
  kasir: id.roles.kasir,
}

export function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role
}

/** "Tanpa kategori" when the product has none or the category list has not loaded it. */
export function categoryLabel(name: string | null | undefined): string {
  return name?.trim() ? name : id.products.noCategory
}

/**
 * The second line of a product row: how much it costs, or how far under the
 * threshold it is.
 *
 * The low-stock list asks a different question from the catalogue — "how far
 * under" rather than "how much" — so it swaps the price for the count against
 * the minimum. Both clients draw this row, and on iOS one of them draws it in
 * SwiftUI and the other in React Native, so the sentence lives here rather than
 * in either drawing.
 */
export function productRowSubtitle(
  product: { sell_price: number; stock: number; min_stock: number; unit: string },
  emphasizeStock: boolean,
): string {
  if (!emphasizeStock) return formatRupiah(product.sell_price)
  return `${id.lowStock.count}: ${formatNumber(product.stock)} / ${formatNumber(product.min_stock)} ${product.unit}`
}

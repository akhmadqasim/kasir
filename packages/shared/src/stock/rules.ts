import type { User } from "../types/auth"
import type { WriteoffReason } from "../types/stock"
import { WRITEOFF_REASONS } from "../types/stock"

/**
 * Who may do what to stock, written once so every screen asks the same
 * question. The server enforces the same rules from the session
 * (`services/stock.rs`, `services/products.rs`); these exist so the UI does not
 * offer a button the server will refuse.
 */

export type Role = User["role"]

/** Reasons this role may pick. `lost` has no physical proof, so it is admin-only. */
export function allowedWriteoffReasons(role: Role): readonly WriteoffReason[] {
  return role === "admin"
    ? WRITEOFF_REASONS
    : WRITEOFF_REASONS.filter((reason) => reason !== "lost" && reason !== "other")
}

export function canUseWriteoffReason(role: Role, reason: WriteoffReason): boolean {
  return allowedWriteoffReasons(role).includes(reason)
}

/** Editing prices, thresholds and setting stock outright all go through `PUT /products/{id}`, an admin route. */
export function canEditProduct(role: Role): boolean {
  return role === "admin"
}

/** Kasir never sees the buying price. */
export function canSeeBuyPrice(role: Role): boolean {
  return role === "admin"
}

/**
 * What a stock count amounts to once the physical quantity is known.
 *
 * - `match`: nothing to do.
 * - `adjust`: set the system stock to the counted value. Admin only, because
 *   the only endpoint that can do it is the whole-row product update.
 * - `writeoff`: counted is *below* system and the missing units can be
 *   explained as damaged/expired (any role) or lost/other (admin). The
 *   write-off quantity is the shortfall.
 * - `blocked`: the count needs a change this role cannot make; `reason` says
 *   why so the screen can print it.
 */
export type StockCountOutcome =
  | { kind: "match" }
  | { kind: "adjust"; newStock: number; difference: number }
  | { kind: "writeoff"; quantity: number; difference: number }
  | { kind: "blocked"; difference: number; reason: "surplus_needs_admin" | "admin_only" }

export interface StockCountInput {
  role: Role
  systemStock: number
  countedStock: number
  /** The kasir's choice of how to explain a shortfall. Ignored for a surplus. */
  writeoffReason?: WriteoffReason | null
}

export function resolveStockCount(input: StockCountInput): StockCountOutcome {
  const difference = input.countedStock - input.systemStock
  if (difference === 0) return { kind: "match" }

  if (input.role === "admin") {
    // An admin explaining a shortfall as damaged/expired/lost keeps the audit
    // row a write-off leaves behind; a bare adjustment leaves none.
    if (difference < 0 && input.writeoffReason) {
      return { kind: "writeoff", quantity: -difference, difference }
    }
    return { kind: "adjust", newStock: input.countedStock, difference }
  }

  if (difference > 0) {
    return { kind: "blocked", difference, reason: "surplus_needs_admin" }
  }

  if (input.writeoffReason && canUseWriteoffReason(input.role, input.writeoffReason)) {
    return { kind: "writeoff", quantity: -difference, difference }
  }

  return { kind: "blocked", difference, reason: "admin_only" }
}

/** `null` when the quantity is acceptable, otherwise which rule it broke. */
export function validateWriteoffQuantity(
  quantity: number,
  currentStock: number,
): "not_positive" | "exceeds_stock" | null {
  if (!Number.isInteger(quantity) || quantity <= 0) return "not_positive"
  if (quantity > currentStock) return "exceeds_stock"
  return null
}

/** `stock <= COALESCE(min_stock, 0)` — the one rule `services/products.rs` uses. */
export function isLowStock(product: { stock: number; min_stock: number | null }): boolean {
  return product.stock <= (product.min_stock ?? 0)
}

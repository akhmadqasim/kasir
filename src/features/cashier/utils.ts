import { MAX_CART_QUANTITY } from "@/stores/cart-store"
import type { CartItem } from "./types"

export { formatRupiah } from "@/lib/format"

/** Dipakai baik untuk diskon per baris (`CartItemEditDialog`) maupun diskon transaksi (`DiscountDialog`). */
export const DISCOUNT_TYPES = [
  { key: "fixed", label: "Nominal (Rp)" },
  { key: "percentage", label: "Persen (%)" },
] as const

/**
 * Peringatan (bukan blokir) untuk jumlah yang tidak wajar. Backend mengizinkan
 * stok minus, jadi kasir tetap boleh melanjutkan setelah membaca peringatannya.
 */
export function getQuantityWarning(
  item: Pick<CartItem, "stock" | "unit"> & { is_ppob?: boolean },
  quantity: number,
): string | null {
  if (item.is_ppob) return null

  if (quantity > MAX_CART_QUANTITY) {
    return `Jumlah maksimal ${MAX_CART_QUANTITY.toLocaleString("id-ID")} per baris`
  }

  if (item.stock <= 0) {
    return "Stok habis — pastikan stok sudah diperbarui"
  }

  if (quantity > item.stock) {
    return `Melebihi stok tersedia (${item.stock.toLocaleString("id-ID")} ${item.unit || "pcs"}) — stok akan minus`
  }

  return null
}

/** Floating-point slack on REAL money, the same as the server's check. */
const BELOW_COST_EPSILON = 0.01

/**
 * Whether a PPOB line sells below what the provider charges the shop, given
 * `net`: what the line brings in after its discounts. The server refuses such
 * a line at checkout (`resolve_ppob_line` for the line's own discount,
 * `reject_ppob_lines_below_cost` once the cart discount took its share), so
 * the cart catches it first. Goods lines are free to go below cost.
 */
export function isPpobBelowCost(
  item: Pick<CartItem, "is_ppob" | "buy_price">,
  net: number,
): boolean {
  if (!item.is_ppob || item.buy_price == null) return false
  return net < item.buy_price - BELOW_COST_EPSILON
}

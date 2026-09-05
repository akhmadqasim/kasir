import { MAX_CART_QUANTITY } from "./hooks/use-cart-store"
import type { CartItem } from "./types"

export { formatRupiah } from "@/lib/format"

/**
 * Peringatan (bukan blokir) untuk jumlah yang tidak wajar. Backend mengizinkan
 * stok minus, jadi kasir tetap boleh melanjutkan setelah membaca peringatannya.
 */
export function getQuantityWarning(
  item: Pick<CartItem, "stock" | "unit"> & { is_ppob?: boolean },
  quantity: number
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

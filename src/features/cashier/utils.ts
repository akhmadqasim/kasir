import type { CartItem } from "./types"

export { formatRupiah } from "@/lib/format"

export function getCartValidationError(items: CartItem[]): string | null {
  const ppobCount = items.filter((item) => item.is_ppob).length

  if (ppobCount > 1) {
    return "Checkout PPOB hanya mendukung 1 item PPOB per transaksi"
  }

  return null
}

export function getAddItemValidationError(
  items: CartItem[],
  nextType: "product" | "ppob"
): string | null {
  const ppobCount = items.filter((item) => item.is_ppob).length

  if (nextType === "ppob" && ppobCount > 0) {
    return "Checkout PPOB hanya mendukung 1 item PPOB per transaksi"
  }

  return null
}

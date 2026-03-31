import type { CartItem } from "./types"

export { formatRupiah } from "@/lib/format"

export function getCartValidationError(_items: CartItem[]): string | null {
  return null
}

export function getAddItemValidationError(
  _items: CartItem[],
  _nextType: "product" | "ppob"
): string | null {
  return null
}

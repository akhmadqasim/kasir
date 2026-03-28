import type { CartItem } from "./types"

export { formatRupiah } from "@/lib/format"

export function getCartValidationError(items: CartItem[]): string | null {
  const ppobCount = items.filter((item) => item.is_ppob).length
  const physicalCount = items.length - ppobCount

  if (ppobCount > 1) {
    return "Checkout PPOB hanya mendukung 1 item PPOB per transaksi"
  }

  if (ppobCount > 0 && physicalCount > 0) {
    return "Item PPOB tidak boleh dicampur dengan barang biasa"
  }

  return null
}

export function getAddItemValidationError(
  items: CartItem[],
  nextType: "product" | "ppob"
): string | null {
  const ppobCount = items.filter((item) => item.is_ppob).length
  const physicalCount = items.length - ppobCount

  if (nextType === "product" && ppobCount > 0) {
    return "Selesaikan transaksi PPOB terlebih dahulu sebelum menambah barang biasa"
  }

  if (nextType === "ppob" && physicalCount > 0) {
    return "Item PPOB tidak boleh dicampur dengan barang biasa"
  }

  if (nextType === "ppob" && ppobCount > 0) {
    return "Checkout PPOB hanya mendukung 1 item PPOB per transaksi"
  }

  return null
}

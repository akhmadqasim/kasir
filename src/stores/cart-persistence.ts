import type { CartItem } from "@/features/cashier/types"
import type { DiscountEntry } from "./cart-totals"

export interface HeldCart {
  id: string
  label: string
  items: CartItem[]
  /** Discounts travel with the cart, never with the terminal */
  itemDiscounts: Record<string, DiscountEntry>
  transactionDiscount: DiscountEntry | null
  /** Total after discounts */
  total: number
  heldAt: number
}

/** The slice of the cart store written to `localStorage`. */
export interface PersistedCart {
  items: CartItem[]
  ppobCounter: number
  heldCarts: HeldCart[]
  itemDiscounts: Record<string, DiscountEntry>
  transactionDiscount: DiscountEntry | null
  /**
   * The `Idempotency-Key` this cart checks out with. `null` until the first
   * attempt, then fixed for the life of the cart (see `getCheckoutKey` in
   * `cart-store.ts`).
   */
  checkoutKey: string | null
}

/**
 * Baris PPOB membawa `ppob_inquiry_id` yang kedaluwarsa dalam hitungan menit.
 * Keranjang yang dipulihkan setelah aplikasi ditutup pasti sudah lewat batas itu,
 * dan checkout dengan inquiry basi berarti pelanggan membayar tapi fulfillment
 * gagal. Jadi buang baris PPOB saat rehydrate, sisakan barang fisiknya.
 */
function dropStalePpobItems(items: CartItem[]): CartItem[] {
  return items.filter((item) => !item.is_ppob)
}

export function migrateCartState(persisted: unknown, version: number): PersistedCart {
  const state = (persisted ?? {}) as Partial<PersistedCart>
  const heldCarts = (state.heldCarts ?? []).map((cart) => ({
    ...cart,
    items: dropStalePpobItems(cart.items ?? []),
  }))

  // Sebelum v1, diskon disimpan global dan ikut bocor ke keranjang berikutnya.
  // Tidak ada cara memetakannya kembali ke keranjang asalnya, jadi dibuang.
  if (version < 1) {
    return {
      items: dropStalePpobItems(state.items ?? []),
      ppobCounter: state.ppobCounter ?? 0,
      heldCarts,
      itemDiscounts: {},
      transactionDiscount: null,
      checkoutKey: null,
    }
  }

  return {
    items: dropStalePpobItems(state.items ?? []),
    ppobCounter: state.ppobCounter ?? 0,
    heldCarts,
    itemDiscounts: state.itemDiscounts ?? {},
    transactionDiscount: state.transactionDiscount ?? null,
    checkoutKey: state.checkoutKey ?? null,
  }
}

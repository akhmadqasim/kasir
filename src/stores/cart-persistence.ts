import type { CartItem } from "@/features/cashier/types"
import { computeCartTotals, type DiscountEntry } from "./cart-totals"

export interface HeldCart {
  id: string
  label: string
  items: CartItem[]
  /** Discounts travel with the cart, never with the terminal */
  itemDiscounts: Record<string, DiscountEntry>
  transactionDiscount: DiscountEntry | null
  heldAt: number
}

/**
 * A held cart's total after discounts, computed when shown rather than stored:
 * a stored one went stale whenever the cart's lines were repriced or dropped.
 * Carts saved with the old `total` field still load; it is simply ignored.
 */
export function heldCartTotal(cart: HeldCart): number {
  return computeCartTotals(cart.items, cart.itemDiscounts ?? {}, cart.transactionDiscount ?? null)
    .total
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
  /**
   * The user who last logged in at this till, and so owns the active cart.
   * `null` for a cart saved before it was recorded. See `claimFor`.
   */
  ownerId: number | null
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

/** Discounts keyed by a line that is no longer in the cart would never apply again. */
function pruneDiscounts(
  items: CartItem[],
  itemDiscounts: Record<string, DiscountEntry>,
): Record<string, DiscountEntry> {
  const ids = new Set(items.map((item) => item.cart_id))
  return Object.fromEntries(Object.entries(itemDiscounts).filter(([cartId]) => ids.has(cartId)))
}

/**
 * A held cart after its stale PPOB lines are gone; a cart left with no lines
 * at all is dropped instead of being offered for recall.
 */
function migrateHeldCart(
  { total: _storedTotal, ...cart }: HeldCart & { total?: number },
  keepDiscounts: boolean,
): HeldCart | null {
  const items = dropStalePpobItems(cart.items ?? [])
  if (items.length === 0) return null
  return {
    ...cart,
    items,
    itemDiscounts: keepDiscounts ? pruneDiscounts(items, cart.itemDiscounts ?? {}) : {},
    transactionDiscount: keepDiscounts ? (cart.transactionDiscount ?? null) : null,
  }
}

export function migrateCartState(persisted: unknown, version: number): PersistedCart {
  const state = (persisted ?? {}) as Partial<PersistedCart>
  // Sebelum v1, diskon disimpan global dan ikut bocor ke keranjang berikutnya.
  // Tidak ada cara memetakannya kembali ke keranjang asalnya, jadi dibuang.
  const keepDiscounts = version >= 1
  const heldCarts = (state.heldCarts ?? [])
    .map((cart) => migrateHeldCart(cart, keepDiscounts))
    .filter((cart): cart is HeldCart => cart !== null)
  const items = dropStalePpobItems(state.items ?? [])
  // An active cart that held only PPOB lines is now empty: it ends there, as
  // `clear()` would end it, so its discount and checkout key go with it.
  const keepActive = keepDiscounts && items.length > 0

  return {
    items,
    ppobCounter: state.ppobCounter ?? 0,
    heldCarts,
    itemDiscounts: keepActive ? pruneDiscounts(items, state.itemDiscounts ?? {}) : {},
    transactionDiscount: keepActive ? (state.transactionDiscount ?? null) : null,
    checkoutKey: keepActive ? (state.checkoutKey ?? null) : null,
    ownerId: state.ownerId ?? null,
  }
}

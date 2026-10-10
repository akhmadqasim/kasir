import { create } from "zustand"
import { persist } from "zustand/middleware"
import { createIdempotencyKey } from "@/lib/api/client"
import type { CartItem } from "@/features/cashier/types"
import { migrateCartState, type HeldCart, type PersistedCart } from "./cart-persistence"
import {
  computeCartTotals,
  discountAmount,
  normalizeDiscount,
  type CartTotals,
  type DiscountEntry,
} from "./cart-totals"

export { heldCartTotal, migrateCartState, type HeldCart } from "./cart-persistence"

/** What the catalogue says about a product right now. */
export interface LiveProduct {
  id: number
  sell_price: number
  stock: number
  unit: string
}

/** A cart line whose price moved between being added and now. */
export interface PriceChange {
  name: string
  from: number
  to: number
}

/**
 * Goods lines repriced from the catalogue. Stock and unit follow quietly; a
 * price that moved is reported, because it changes the total the cashier
 * quoted. PPOB lines and products missing from `live` are left alone.
 */
export function refreshGoodsLines(
  items: CartItem[],
  live: ReadonlyMap<number, LiveProduct>,
): { items: CartItem[]; changes: PriceChange[] } {
  const changes: PriceChange[] = []
  let touched = false
  const next = items.map((item) => {
    const product =
      item.is_ppob || item.product_id === undefined ? undefined : live.get(item.product_id)
    if (!product) return item
    if (
      product.sell_price === item.product_price &&
      product.stock === item.stock &&
      product.unit === item.unit
    ) {
      return item
    }
    if (product.sell_price !== item.product_price) {
      changes.push({ name: item.product_name, from: item.product_price, to: product.sell_price })
    }
    touched = true
    return { ...item, product_price: product.sell_price, stock: product.stock, unit: product.unit }
  })
  return { items: touched ? next : items, changes }
}

/** Guards against a barcode landing in a quantity field */
export const MAX_CART_QUANTITY = 9999

/**
 * The automatic name of the next held cart: the first "Pelanggan N", counting
 * up from the number of carts waiting, that no waiting cart carries yet. Two
 * customers called the same in the F9 list could be recalled by mistake.
 */
export function nextHoldLabel(heldCarts: readonly Pick<HeldCart, "label">[]): string {
  const taken = new Set(heldCarts.map((cart) => cart.label))
  let number = heldCarts.length + 1
  while (taken.has(`Pelanggan ${number}`)) number++
  return `Pelanggan ${number}`
}

interface CartStore extends PersistedCart {
  /**
   * Adds one of `product`. A new line takes its price, stock and unit. A line
   * already in the cart is repriced from `product` only when `fresh` is set
   * (a network barcode lookup, the answer `notePricedByLookup` records);
   * otherwise only its quantity goes up, because a shortcut tile or a search
   * row may come from the query cache and carry an older price. Returns the
   * price change when an existing line was repriced.
   */
  addItem: (
    product: {
      id: number
      name: string
      sell_price: number
      stock: number
      unit: string
    },
    options?: { fresh?: boolean },
  ) => PriceChange | null
  addPpobItem: (item: {
    name: string
    price: number
    service_type: string
    service_ref: string
    buy_price?: number
    sell_price?: number
    ppob_product_id?: number
    ppob_product_code?: string
    ppob_inquiry_id?: string
    ppob_payment_code?: string
    ppob_flag_id?: string
  }) => void
  removeItem: (cartId: string) => void
  updateQuantity: (cartId: string, qty: number) => void
  updatePrice: (cartId: string, price: number) => void
  /** Saved clamped: a percentage to 100, a fixed amount to the line's total. */
  setItemDiscount: (cartId: string, discount: DiscountEntry | null) => void
  /**
   * A percentage is saved clamped to 100; a fixed amount is saved as typed and
   * capped only when totals are computed, so it grows into a cart that grows.
   */
  setTransactionDiscount: (discount: DiscountEntry | null) => void
  clearDiscounts: () => void
  getItemDiscountAmount: (cartId: string) => number
  getItemDiscountsTotal: () => number
  getTransactionDiscountAmount: () => number
  getCartTotals: () => CartTotals
  getTotalDiscount: () => number
  getSubtotal: () => number
  getTotal: () => number
  clear: () => void
  holdCart: (label?: string) => void
  /**
   * Swaps the held cart in. A non-empty active cart is held in its place, under
   * the next free automatic name (`nextHoldLabel`); returns that name, or `null`
   * when nothing was parked.
   */
  recallCart: (holdId: string) => string | null
  removeHeldCart: (holdId: string) => void
  /**
   * Reprices the active cart's goods lines — and with `includeHeld` every held
   * cart's — from the catalogue, and returns the price changes in the active cart.
   */
  applyLiveProducts: (
    live: ReadonlyMap<number, LiveProduct>,
    options?: { includeHeld?: boolean },
  ) => PriceChange[]
  /**
   * Hands the till to `userId` at login. A cart left by a *different* user —
   * their session expired, or the app was closed mid-sale — is emptied, so
   * the next cashier cannot ring it up as their own; the same user logging
   * back in keeps it. Returns whether the till changed hands.
   */
  claimFor: (userId: number) => boolean
  /** Mints {@link PersistedCart.checkoutKey} on the first checkout attempt and returns it. */
  getCheckoutKey: () => string
}

/**
 * The cart as it stands, parked under `id` — for holding a cart, and for the
 * active cart that recalling another one swaps out.
 */
function snapshotCart(
  { items, itemDiscounts, transactionDiscount }: PersistedCart,
  id: string,
  label: string,
): HeldCart {
  return {
    id,
    label,
    items: [...items],
    itemDiscounts: { ...itemDiscounts },
    transactionDiscount,
    heldAt: Date.now(),
  }
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      ppobCounter: 0,
      heldCarts: [],
      itemDiscounts: {},
      transactionDiscount: null,
      checkoutKey: null,
      ownerId: null,

      addItem: (product, options) => {
        const { items } = get()
        const existing = items.find((item) => !item.is_ppob && item.product_id === product.id)

        if (existing) {
          // Move to top and increment quantity. Only a fresh lookup is the
          // catalogue of the moment, so only then do its price, stock and unit
          // replace the line's: a cached tile or search row could roll a newer
          // price back to an old one. The background check reprices the rest.
          const bumped = {
            ...existing,
            quantity: Math.min(existing.quantity + 1, MAX_CART_QUANTITY),
          }
          const { items: refreshed, changes } = options?.fresh
            ? refreshGoodsLines([bumped], new Map([[product.id, product]]))
            : { items: [bumped], changes: [] }
          set({
            items: [refreshed[0], ...items.filter((item) => item.cart_id !== existing.cart_id)],
          })
          return changes[0] ?? null
        } else {
          // Prepend new item at top
          set({
            items: [
              {
                cart_id: `product-${product.id}`,
                product_id: product.id,
                product_name: product.name,
                product_price: product.sell_price,
                quantity: 1,
                stock: product.stock,
                unit: product.unit,
              },
              ...items,
            ],
          })
          return null
        }
      },

      addPpobItem: (item) => {
        const counter = get().ppobCounter + 1
        const sellPrice = item.sell_price ?? item.price
        set({
          ppobCounter: counter,
          items: [
            {
              cart_id: `ppob-${counter}-${Date.now()}`,
              product_name: item.name,
              product_price: sellPrice,
              quantity: 1,
              stock: 0,
              unit: "pcs",
              is_ppob: true,
              service_type: item.service_type,
              service_ref: item.service_ref,
              buy_price: item.buy_price ?? item.price,
              sell_price: sellPrice,
              ppob_product_id: item.ppob_product_id,
              ppob_product_code: item.ppob_product_code,
              ppob_inquiry_id: item.ppob_inquiry_id,
              ppob_payment_code: item.ppob_payment_code,
              ppob_flag_id: item.ppob_flag_id,
            },
            ...get().items,
          ],
        })
      },

      removeItem: (cartId) => {
        const { itemDiscounts } = get()
        const { [cartId]: _removed, ...restDiscounts } = itemDiscounts
        const items = get().items.filter((item) => item.cart_id !== cartId)
        // Removing the last line empties the cart just like `clear()` does: the
        // next customer must not inherit this one's discount, nor its checkout
        // key (a reused key would replay this sale instead of ringing up theirs).
        if (items.length === 0) {
          get().clear()
          return
        }
        set({ items, itemDiscounts: restDiscounts })
      },

      updateQuantity: (cartId, qty) => {
        const { items } = get()
        const item = items.find((i) => i.cart_id === cartId)
        if (!item) return
        if (item.is_ppob) return

        const validQty = Math.min(Math.max(1, Math.trunc(qty) || 1), MAX_CART_QUANTITY)
        set({
          items: items.map((i) => (i.cart_id === cartId ? { ...i, quantity: validQty } : i)),
        })
      },

      updatePrice: (cartId, price) => {
        const { items } = get()
        const item = items.find((i) => i.cart_id === cartId)
        if (!item || !item.is_ppob) return

        const validPrice = Math.max(0, price)
        set({
          items: items.map((i) =>
            i.cart_id === cartId ? { ...i, product_price: validPrice, sell_price: validPrice } : i,
          ),
        })
      },

      // A fixed amount is saved clamped, not only capped when totals are
      // computed: kept whole, 50.000 off a 10.000 line would make that line
      // free once its quantity went up.
      setItemDiscount: (cartId, discount) => {
        const { items, itemDiscounts } = get()
        const item = items.find((i) => i.cart_id === cartId)
        const base = item ? item.product_price * item.quantity : Infinity
        const saved = normalizeDiscount(discount, base).entry
        if (!saved) {
          const { [cartId]: _removed, ...rest } = itemDiscounts
          set({ itemDiscounts: rest })
        } else {
          set({ itemDiscounts: { ...itemDiscounts, [cartId]: saved } })
        }
      },

      // Unlike a line discount, the cart discount keeps a fixed amount whole:
      // 10.000 typed on an 8.000 cart must become 10.000 off once more items
      // are scanned. `computeCartTotals` caps it to what the cart can take.
      setTransactionDiscount: (discount) => {
        set({ transactionDiscount: normalizeDiscount(discount, Infinity).entry })
      },

      clearDiscounts: () => {
        set({ itemDiscounts: {}, transactionDiscount: null })
      },

      getItemDiscountAmount: (cartId) => {
        const { items, itemDiscounts } = get()
        const item = items.find((i) => i.cart_id === cartId)
        const disc = itemDiscounts[cartId]
        if (!item || !disc) return 0
        return discountAmount(item.product_price * item.quantity, disc)
      },

      getItemDiscountsTotal: () => {
        return get().getCartTotals().itemDiscountsTotal
      },

      getTransactionDiscountAmount: () => {
        return get().getCartTotals().transactionDiscountAmount
      },

      getCartTotals: () => {
        const { items, itemDiscounts, transactionDiscount } = get()
        return computeCartTotals(items, itemDiscounts, transactionDiscount)
      },

      getTotalDiscount: () => {
        return get().getCartTotals().totalDiscount
      },

      getSubtotal: () => {
        return get().getCartTotals().subtotal
      },

      getTotal: () => {
        return get().getCartTotals().total
      },

      /**
       * The key this cart's checkout attempts share.
       *
       * Minted once, on the first attempt, and kept until the cart is emptied,
       * held, or swapped out. That lifetime is the whole point of the header.
       * Over IPC, a checkout either happened or it did not; over HTTP there is a
       * third outcome — the sale committed and the answer was lost on shop wifi
       * — and a retry from that state is indistinguishable from a request that
       * never arrived. Reusing the key makes the server replay the first sale
       * instead of ringing up a second one.
       *
       * A key per *retry* would defeat it entirely. A key per *cashier session*
       * would be worse: the second genuine sale of the day would come back as a
       * replay of the first.
       *
       * A failed attempt releases the key on the server, so correcting the cart
       * and trying again works with the same key. It is only a *completed* key
       * with a different body that is refused, which is exactly the case worth
       * refusing: that sale already went through.
       */
      getCheckoutKey: () => {
        const existing = get().checkoutKey
        if (existing) return existing

        const key = createIdempotencyKey()
        set({ checkoutKey: key })
        return key
      },

      // Emptying the cart ends the attempt the key belonged to. The next sale is
      // a different sale and gets a different key.
      clear: () =>
        set({
          items: [],
          itemDiscounts: {},
          transactionDiscount: null,
          checkoutKey: null,
        }),

      holdCart: (label?: string) => {
        const state = get()
        if (state.items.length === 0) return

        const autoLabel = label?.trim() || nextHoldLabel(state.heldCarts)

        set({
          heldCarts: [...state.heldCarts, snapshotCart(state, `hold-${Date.now()}`, autoLabel)],
          items: [],
          itemDiscounts: {},
          transactionDiscount: null,
          // A held cart is a different customer. Holding one ends this attempt.
          checkoutKey: null,
        })
      },

      recallCart: (holdId: string) => {
        const state = get()
        const { heldCarts } = state
        const held = heldCarts.find((c) => c.id === holdId)
        if (!held) return null

        const remaining = heldCarts.filter((c) => c.id !== holdId)
        // A non-empty active cart is held first, under a name no other waiting
        // cart carries, or the F9 list shows two of the same.
        const parkedLabel = state.items.length > 0 ? nextHoldLabel(remaining) : null
        set({
          heldCarts: parkedLabel
            ? [...remaining, snapshotCart(state, `hold-${Date.now()}`, parkedLabel)]
            : remaining,
          items: held.items,
          // Held carts persisted before discounts were scoped have no discounts.
          itemDiscounts: held.itemDiscounts ?? {},
          transactionDiscount: held.transactionDiscount ?? null,
          // A different customer's cart starts its own checkout attempt.
          checkoutKey: null,
        })
        return parkedLabel
      },

      applyLiveProducts: (live, { includeHeld = false } = {}) => {
        const state = get()
        const active = refreshGoodsLines(state.items, live)
        const update: Partial<PersistedCart> = {}
        if (active.items !== state.items) update.items = active.items
        if (includeHeld) {
          let heldTouched = false
          const heldCarts = state.heldCarts.map((cart) => {
            const { items } = refreshGoodsLines(cart.items, live)
            if (items === cart.items) return cart
            heldTouched = true
            return { ...cart, items }
          })
          if (heldTouched) update.heldCarts = heldCarts
        }
        if (update.items || update.heldCarts) set(update)
        return active.changes
      },

      claimFor: (userId) => {
        const { ownerId } = get()
        const changedHands = ownerId !== null && ownerId !== userId
        // Held carts stay: they are customers still waiting at the counter,
        // which logout leaves in place too.
        if (changedHands) get().clear()
        set({ ownerId: userId })
        return changedHands
      },

      removeHeldCart: (holdId: string) => {
        set({
          heldCarts: get().heldCarts.filter((c) => c.id !== holdId),
        })
      },
    }),
    {
      name: "kasir-cart",
      version: 1,
      partialize: (state) => ({
        items: state.items,
        ppobCounter: state.ppobCounter,
        heldCarts: state.heldCarts,
        itemDiscounts: state.itemDiscounts,
        transactionDiscount: state.transactionDiscount,
        // Persisted with the cart it belongs to. A reload in the middle of a
        // checkout is precisely the case the key exists for: the cart comes
        // back, and so does the key that stops it being rung up twice.
        checkoutKey: state.checkoutKey,
        ownerId: state.ownerId,
      }),
      migrate: migrateCartState,
      // `migrate` only runs when the stored version differs from `version`, so a
      // cart this build saved would skip it. Stale PPOB rows must go on every
      // hydrate, hence the same normalisation here.
      merge: (persisted, current) =>
        persisted ? { ...current, ...migrateCartState(persisted, 1) } : current,
    },
  ),
)

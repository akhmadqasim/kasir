import { create } from "zustand"
import { persist } from "zustand/middleware"
import { createIdempotencyKey } from "@/lib/api/client"
import { migrateCartState, type HeldCart, type PersistedCart } from "./cart-persistence"
import {
  computeCartTotals,
  discountAmount,
  type CartTotals,
  type DiscountEntry,
} from "./cart-totals"

export { migrateCartState, type HeldCart } from "./cart-persistence"

/** Guards against a barcode landing in a quantity field */
export const MAX_CART_QUANTITY = 9999

interface CartStore extends PersistedCart {
  addItem: (product: {
    id: number
    name: string
    sell_price: number
    stock: number
    unit: string
  }) => void
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
  setItemDiscount: (cartId: string, discount: DiscountEntry | null) => void
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
  recallCart: (holdId: string) => void
  removeHeldCart: (holdId: string) => void
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
    total: computeCartTotals(items, itemDiscounts, transactionDiscount).total,
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

      addItem: (product) => {
        const { items } = get()
        const existing = items.find((item) => !item.is_ppob && item.product_id === product.id)

        if (existing) {
          // Move to top and increment quantity
          const updated = {
            ...existing,
            quantity: Math.min(existing.quantity + 1, MAX_CART_QUANTITY),
          }
          set({
            items: [updated, ...items.filter((item) => item.cart_id !== existing.cart_id)],
          })
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
        set({
          items: get().items.filter((item) => item.cart_id !== cartId),
          itemDiscounts: restDiscounts,
        })
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

      setItemDiscount: (cartId, discount) => {
        const { itemDiscounts } = get()
        if (!discount || discount.value <= 0) {
          const { [cartId]: _removed, ...rest } = itemDiscounts
          set({ itemDiscounts: rest })
        } else {
          set({ itemDiscounts: { ...itemDiscounts, [cartId]: discount } })
        }
      },

      setTransactionDiscount: (discount) => {
        set({
          transactionDiscount: discount && discount.value > 0 ? discount : null,
        })
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

        const autoLabel = label?.trim() || `Pelanggan ${state.heldCarts.length + 1}`

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
        if (!held) return

        // Held carts persisted before discounts were scoped have no discounts
        const heldItemDiscounts = held.itemDiscounts ?? {}
        const heldTransactionDiscount = held.transactionDiscount ?? null

        // If current cart has items, hold them first
        if (state.items.length > 0) {
          set({
            heldCarts: [
              ...heldCarts.filter((c) => c.id !== holdId),
              snapshotCart(state, `hold-${Date.now()}`, "Keranjang Aktif"),
            ],
            items: held.items,
            itemDiscounts: heldItemDiscounts,
            transactionDiscount: heldTransactionDiscount,
            checkoutKey: null,
          })
        } else {
          set({
            heldCarts: heldCarts.filter((c) => c.id !== holdId),
            items: held.items,
            itemDiscounts: heldItemDiscounts,
            transactionDiscount: heldTransactionDiscount,
            // Recalling swaps in a different customer's cart, so it starts its
            // own attempt rather than inheriting the outgoing one's key.
            checkoutKey: null,
          })
        }
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

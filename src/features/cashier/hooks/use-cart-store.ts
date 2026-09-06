import { create } from "zustand"
import { persist } from "zustand/middleware"
import { createIdempotencyKey } from "@/lib/api/client"
import type { CartItem } from "../types"

/** Guards against a barcode landing in a quantity field */
export const MAX_CART_QUANTITY = 9999

export interface DiscountEntry {
  type: "fixed" | "percentage"
  value: number
}

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

interface CartStore {
  items: CartItem[]
  ppobCounter: number
  heldCarts: HeldCart[]
  itemDiscounts: Record<string, DiscountEntry>
  transactionDiscount: DiscountEntry | null
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
  getCartTotals: () => { subtotal: number; totalDiscount: number; total: number }
  getTotalDiscount: () => number
  getSubtotal: () => number
  getTotal: () => number
  clear: () => void
  holdCart: (label?: string) => void
  recallCart: (holdId: string) => void
  removeHeldCart: (holdId: string) => void
  /**
   * The `Idempotency-Key` this cart checks out with.
   *
   * `null` until the first attempt, then fixed for the life of the cart. See
   * {@link CartStore.getCheckoutKey}.
   */
  checkoutKey: string | null
  getCheckoutKey: () => string
}

type PersistedCart = Pick<
  CartStore,
  | "items"
  | "ppobCounter"
  | "heldCarts"
  | "itemDiscounts"
  | "transactionDiscount"
  | "checkoutKey"
>

/**
 * Baris PPOB membawa `ppob_inquiry_id` yang kedaluwarsa dalam hitungan menit.
 * Keranjang yang dipulihkan setelah aplikasi ditutup pasti sudah lewat batas itu,
 * dan checkout dengan inquiry basi berarti pelanggan membayar tapi fulfillment
 * gagal. Jadi buang baris PPOB saat rehydrate, sisakan barang fisiknya.
 */
export function dropStalePpobItems(items: CartItem[]): CartItem[] {
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
        const existing = items.find(
          (item) => !item.is_ppob && item.product_id === product.id
        )

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
          items: items.map((i) =>
            i.cart_id === cartId ? { ...i, quantity: validQty } : i
          ),
        })
      },

      updatePrice: (cartId, price) => {
        const { items } = get()
        const item = items.find((i) => i.cart_id === cartId)
        if (!item || !item.is_ppob) return

        const validPrice = Math.max(0, price)
        set({
          items: items.map((i) =>
            i.cart_id === cartId
              ? { ...i, product_price: validPrice, sell_price: validPrice }
              : i
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
          transactionDiscount:
            discount && discount.value > 0 ? discount : null,
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
        const lineTotal = item.product_price * item.quantity
        if (disc.type === "percentage") {
          return Math.round(lineTotal * disc.value / 100)
        }
        return Math.min(disc.value, lineTotal)
      },

      getItemDiscountsTotal: () => {
        const { items, itemDiscounts } = get()
        let total = 0
        for (const item of items) {
          const disc = itemDiscounts[item.cart_id]
          if (!disc) continue
          const lineTotal = item.product_price * item.quantity
          if (disc.type === "percentage") {
            total += Math.round(lineTotal * disc.value / 100)
          } else {
            total += Math.min(disc.value, lineTotal)
          }
        }
        return total
      },

      getTransactionDiscountAmount: () => {
        const { transactionDiscount } = get()
        if (!transactionDiscount) return 0
        const subtotal = get().getSubtotal()
        const itemDiscTotal = get().getItemDiscountsTotal()
        const afterItemDisc = subtotal - itemDiscTotal
        if (transactionDiscount.type === "percentage") {
          return Math.round(afterItemDisc * transactionDiscount.value / 100)
        }
        return Math.min(transactionDiscount.value, afterItemDisc)
      },

      getCartTotals: () => {
        const { items, itemDiscounts, transactionDiscount } = get()
        let subtotal = 0
        let itemDiscTotal = 0
        for (const item of items) {
          const lineTotal = item.product_price * item.quantity
          subtotal += lineTotal
          const disc = itemDiscounts[item.cart_id]
          if (disc) {
            if (disc.type === "percentage") {
              itemDiscTotal += Math.round(lineTotal * disc.value / 100)
            } else {
              itemDiscTotal += Math.min(disc.value, lineTotal)
            }
          }
        }
        const afterItemDisc = subtotal - itemDiscTotal
        const txnDiscAmount = transactionDiscount
          ? (transactionDiscount.type === "percentage"
              ? Math.round(afterItemDisc * transactionDiscount.value / 100)
              : Math.min(transactionDiscount.value, afterItemDisc))
          : 0
        const totalDiscount = itemDiscTotal + txnDiscAmount
        return { subtotal, totalDiscount, total: Math.max(0, subtotal - totalDiscount) }
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
        const { items, heldCarts, itemDiscounts, transactionDiscount } = get()
        if (items.length === 0) return

        const { total } = get().getCartTotals()
        const holdId = `hold-${Date.now()}`
        const autoLabel = label?.trim() || `Pelanggan ${heldCarts.length + 1}`

        set({
          heldCarts: [
            ...heldCarts,
            {
              id: holdId,
              label: autoLabel,
              items: [...items],
              itemDiscounts: { ...itemDiscounts },
              transactionDiscount,
              total,
              heldAt: Date.now(),
            },
          ],
          items: [],
          itemDiscounts: {},
          transactionDiscount: null,
          // A held cart is a different customer. Holding one ends this attempt.
          checkoutKey: null,
        })
      },

      recallCart: (holdId: string) => {
        const { heldCarts, items, itemDiscounts, transactionDiscount } = get()
        const held = heldCarts.find((c) => c.id === holdId)
        if (!held) return

        // Held carts persisted before discounts were scoped have no discounts
        const heldItemDiscounts = held.itemDiscounts ?? {}
        const heldTransactionDiscount = held.transactionDiscount ?? null

        // If current cart has items, hold them first
        if (items.length > 0) {
          const { total } = get().getCartTotals()
          const swapId = `hold-${Date.now()}`
          set({
            heldCarts: [
              ...heldCarts.filter((c) => c.id !== holdId),
              {
                id: swapId,
                label: `Keranjang Aktif`,
                items: [...items],
                itemDiscounts: { ...itemDiscounts },
                transactionDiscount,
                total,
                heldAt: Date.now(),
              },
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
    }
  )
)

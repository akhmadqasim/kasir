import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { CartItem } from "../types"

export interface HeldCart {
  id: string
  label: string
  items: CartItem[]
  total: number
  heldAt: number
}

interface CartStore {
  items: CartItem[]
  ppobCounter: number
  heldCarts: HeldCart[]
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
  }) => void
  removeItem: (cartId: string) => void
  updateQuantity: (cartId: string, qty: number) => void
  updatePrice: (cartId: string, price: number) => void
  clear: () => void
  getTotal: () => number
  holdCart: (label?: string) => void
  recallCart: (holdId: string) => void
  removeHeldCart: (holdId: string) => void
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      ppobCounter: 0,
      heldCarts: [],

      addItem: (product) => {
        const { items } = get()
        const existing = items.find(
          (item) => !item.is_ppob && item.product_id === product.id
        )

        if (existing) {
          set({
            items: items.map((item) =>
              item.cart_id === existing.cart_id
                ? { ...item, quantity: item.quantity + 1 }
                : item
            ),
          })
        } else {
          set({
            items: [
              ...items,
              {
                cart_id: `product-${product.id}`,
                product_id: product.id,
                product_name: product.name,
                product_price: product.sell_price,
                quantity: 1,
                stock: product.stock,
                unit: product.unit,
              },
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
            ...get().items,
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
            },
          ],
        })
      },

      removeItem: (cartId) => {
        set({ items: get().items.filter((item) => item.cart_id !== cartId) })
      },

      updateQuantity: (cartId, qty) => {
        const { items } = get()
        const item = items.find((i) => i.cart_id === cartId)
        if (!item) return
        if (item.is_ppob) return

        const validQty = Math.max(1, qty)
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

      clear: () => set({ items: [] }),

      getTotal: () => {
        return get().items.reduce(
          (sum, item) => sum + item.product_price * item.quantity,
          0
        )
      },

      holdCart: (label?: string) => {
        const { items, heldCarts } = get()
        if (items.length === 0) return

        const total = items.reduce(
          (sum, item) => sum + item.product_price * item.quantity,
          0
        )
        const holdId = `hold-${Date.now()}`
        const autoLabel = label?.trim() || `Pelanggan ${heldCarts.length + 1}`

        set({
          heldCarts: [
            ...heldCarts,
            {
              id: holdId,
              label: autoLabel,
              items: [...items],
              total,
              heldAt: Date.now(),
            },
          ],
          items: [],
        })
      },

      recallCart: (holdId: string) => {
        const { heldCarts, items } = get()
        const held = heldCarts.find((c) => c.id === holdId)
        if (!held) return

        // If current cart has items, hold them first
        if (items.length > 0) {
          const total = items.reduce(
            (sum, item) => sum + item.product_price * item.quantity,
            0
          )
          const swapId = `hold-${Date.now()}`
          set({
            heldCarts: [
              ...heldCarts.filter((c) => c.id !== holdId),
              {
                id: swapId,
                label: `Keranjang Aktif`,
                items: [...items],
                total,
                heldAt: Date.now(),
              },
            ],
            items: held.items,
          })
        } else {
          set({
            heldCarts: heldCarts.filter((c) => c.id !== holdId),
            items: held.items,
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
      partialize: (state) => ({
        items: state.items,
        ppobCounter: state.ppobCounter,
        heldCarts: state.heldCarts,
      }),
    }
  )
)

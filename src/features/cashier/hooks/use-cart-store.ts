import { create } from "zustand"
import type { CartItem } from "../types"

interface CartStore {
  items: CartItem[]
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
    ppob_product_code?: string
  }) => void
  removeItem: (cartId: string) => void
  updateQuantity: (cartId: string, qty: number) => void
  updatePrice: (cartId: string, price: number) => void
  clear: () => void
  getTotal: () => number
}

let ppobCounter = 0

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],

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
    ppobCounter++
    const sellPrice = item.sell_price ?? item.price
    set({
      items: [
        ...get().items,
        {
          cart_id: `ppob-${ppobCounter}-${Date.now()}`,
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
          ppob_product_code: item.ppob_product_code,
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
    // PPOB items always qty=1
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
}))

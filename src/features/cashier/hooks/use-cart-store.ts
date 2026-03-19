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
  removeItem: (productId: number) => void
  updateQuantity: (productId: number, qty: number) => void
  clear: () => void
  getTotal: () => number
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],

  addItem: (product) => {
    const { items } = get()
    const existing = items.find((item) => item.product_id === product.id)

    if (existing) {
      set({
        items: items.map((item) =>
          item.product_id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        ),
      })
    } else {
      set({
        items: [
          ...items,
          {
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

  removeItem: (productId) => {
    set({ items: get().items.filter((item) => item.product_id !== productId) })
  },

  updateQuantity: (productId, qty) => {
    const { items } = get()
    const item = items.find((i) => i.product_id === productId)
    if (!item) return

    const validQty = Math.max(1, qty)
    set({
      items: items.map((i) =>
        i.product_id === productId ? { ...i, quantity: validQty } : i
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

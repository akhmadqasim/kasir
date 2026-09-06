import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  MAX_CART_QUANTITY,
  migrateCartState,
  useCartStore,
  type HeldCart,
} from "../use-cart-store"

// ── Helpers ──────────────────────────────────────────────────────────

function makeProduct(overrides: Partial<{ id: number; name: string; sell_price: number; stock: number; unit: string }> = {}) {
  return {
    id: 1,
    name: "Indomie Goreng",
    sell_price: 3000,
    stock: 100,
    unit: "pcs",
    ...overrides,
  }
}

function store() {
  return useCartStore.getState()
}

// ── Reset store between tests ────────────────────────────────────────

beforeEach(() => {
  useCartStore.setState({
    items: [],
    ppobCounter: 0,
    heldCarts: [],
    itemDiscounts: {},
    transactionDiscount: null,
    checkoutKey: null,
  })
})

// =====================================================================
// addItem
// =====================================================================

describe("addItem", () => {
  it("adds a new product to cart", () => {
    store().addItem(makeProduct())

    const { items } = store()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      cart_id: "product-1",
      product_id: 1,
      product_name: "Indomie Goreng",
      product_price: 3000,
      quantity: 1,
      stock: 100,
      unit: "pcs",
    })
  })

  it("increments quantity when same product is added again", () => {
    store().addItem(makeProduct())
    store().addItem(makeProduct())

    const { items } = store()
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBe(2)
  })

  it("increments quantity on third add", () => {
    store().addItem(makeProduct())
    store().addItem(makeProduct())
    store().addItem(makeProduct())

    expect(store().items[0].quantity).toBe(3)
  })

  it("adds different products as separate items", () => {
    store().addItem(makeProduct({ id: 1, name: "Indomie Goreng", sell_price: 3000 }))
    store().addItem(makeProduct({ id: 2, name: "Teh Botol", sell_price: 5000 }))

    expect(store().items).toHaveLength(2)
    // newest item is prepended to top
    expect(store().items[0].product_name).toBe("Teh Botol")
    expect(store().items[1].product_name).toBe("Indomie Goreng")
  })

  it("generates cart_id from product id", () => {
    store().addItem(makeProduct({ id: 42 }))
    expect(store().items[0].cart_id).toBe("product-42")
  })
})

// =====================================================================
// addPpobItem
// =====================================================================

describe("addPpobItem", () => {
  it("adds a PPOB item to cart", () => {
    store().addPpobItem({
      name: "Pulsa Telkomsel 50K",
      price: 51000,
      service_type: "pulsa",
      service_ref: "08123456789",
    })

    const { items } = store()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      product_name: "Pulsa Telkomsel 50K",
      product_price: 51000,
      quantity: 1,
      is_ppob: true,
      service_type: "pulsa",
      service_ref: "08123456789",
    })
  })

  it("uses sell_price over price when provided", () => {
    store().addPpobItem({
      name: "Token PLN",
      price: 100000,
      sell_price: 102000,
      service_type: "pln",
      service_ref: "123456",
    })

    expect(store().items[0].product_price).toBe(102000)
  })

  it("always adds as a new line item (never merges)", () => {
    const ppobItem = {
      name: "Pulsa XL 25K",
      price: 26000,
      service_type: "pulsa",
      service_ref: "08789",
    }
    store().addPpobItem(ppobItem)
    store().addPpobItem(ppobItem)

    expect(store().items).toHaveLength(2)
  })

  it("increments ppobCounter", () => {
    expect(store().ppobCounter).toBe(0)
    store().addPpobItem({ name: "A", price: 1000, service_type: "pulsa", service_ref: "x" })
    expect(store().ppobCounter).toBe(1)
    store().addPpobItem({ name: "B", price: 2000, service_type: "pln", service_ref: "y" })
    expect(store().ppobCounter).toBe(2)
  })
})

// =====================================================================
// removeItem
// =====================================================================

describe("removeItem", () => {
  it("removes an item from cart by cart_id", () => {
    store().addItem(makeProduct({ id: 1, name: "A" }))
    store().addItem(makeProduct({ id: 2, name: "B" }))

    store().removeItem("product-1")

    const { items } = store()
    expect(items).toHaveLength(1)
    expect(items[0].product_name).toBe("B")
  })

  it("does nothing if cart_id not found", () => {
    store().addItem(makeProduct())
    store().removeItem("nonexistent")
    expect(store().items).toHaveLength(1)
  })

  it("also removes the item discount for that item", () => {
    store().addItem(makeProduct({ id: 1 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 500 })
    expect(store().itemDiscounts["product-1"]).toBeDefined()

    store().removeItem("product-1")
    expect(store().itemDiscounts["product-1"]).toBeUndefined()
  })
})

// =====================================================================
// updateQuantity
// =====================================================================

describe("updateQuantity", () => {
  it("updates quantity of an existing item", () => {
    store().addItem(makeProduct())
    store().updateQuantity("product-1", 5)
    expect(store().items[0].quantity).toBe(5)
  })

  it("enforces minimum quantity of 1", () => {
    store().addItem(makeProduct())
    store().updateQuantity("product-1", 0)
    expect(store().items[0].quantity).toBe(1)

    store().updateQuantity("product-1", -3)
    expect(store().items[0].quantity).toBe(1)
  })

  it("does nothing if cart_id not found", () => {
    store().addItem(makeProduct())
    store().updateQuantity("nonexistent", 10)
    expect(store().items[0].quantity).toBe(1)
  })

  it("caps the quantity at the maximum", () => {
    store().addItem(makeProduct())
    store().updateQuantity("product-1", 8991002103011)
    expect(store().items[0].quantity).toBe(MAX_CART_QUANTITY)
  })

  it("caps the quantity when the same product keeps being scanned", () => {
    store().addItem(makeProduct())
    store().updateQuantity("product-1", MAX_CART_QUANTITY)
    store().addItem(makeProduct())
    expect(store().items[0].quantity).toBe(MAX_CART_QUANTITY)
  })

  it("does not update quantity for PPOB items", () => {
    store().addPpobItem({
      name: "Pulsa",
      price: 50000,
      service_type: "pulsa",
      service_ref: "08123",
    })

    const cartId = store().items[0].cart_id
    store().updateQuantity(cartId, 5)
    expect(store().items[0].quantity).toBe(1)
  })
})

// =====================================================================
// updatePrice
// =====================================================================

describe("updatePrice", () => {
  it("updates price of a PPOB item", () => {
    store().addPpobItem({
      name: "Token PLN",
      price: 100000,
      service_type: "pln",
      service_ref: "meter-123",
    })

    const cartId = store().items[0].cart_id
    store().updatePrice(cartId, 105000)
    expect(store().items[0].product_price).toBe(105000)
    expect(store().items[0].sell_price).toBe(105000)
  })

  it("does not update price of a non-PPOB item", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 3000 }))
    store().updatePrice("product-1", 9999)
    expect(store().items[0].product_price).toBe(3000)
  })

  it("enforces minimum price of 0", () => {
    store().addPpobItem({
      name: "Token",
      price: 100000,
      service_type: "pln",
      service_ref: "x",
    })
    const cartId = store().items[0].cart_id
    store().updatePrice(cartId, -500)
    expect(store().items[0].product_price).toBe(0)
  })
})

// =====================================================================
// clear
// =====================================================================

describe("clear", () => {
  it("empties the cart and discounts", () => {
    store().addItem(makeProduct({ id: 1 }))
    store().addItem(makeProduct({ id: 2 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 500 })
    store().setTransactionDiscount({ type: "percentage", value: 10 })

    store().clear()

    expect(store().items).toHaveLength(0)
    expect(store().itemDiscounts).toEqual({})
    expect(store().transactionDiscount).toBeNull()
  })

  it("keeps held carts when clearing active cart", () => {
    store().addItem(makeProduct())
    store().holdCart("Customer 1")
    // After hold, active cart is cleared, but held carts exist
    store().addItem(makeProduct({ id: 2 }))
    store().clear()

    expect(store().items).toHaveLength(0)
    expect(store().heldCarts).toHaveLength(1)
  })
})

// =====================================================================
// Discounts — item level
// =====================================================================

describe("setItemDiscount", () => {
  it("sets a fixed discount on an item", () => {
    store().addItem(makeProduct())
    store().setItemDiscount("product-1", { type: "fixed", value: 500 })

    expect(store().itemDiscounts["product-1"]).toEqual({
      type: "fixed",
      value: 500,
    })
  })

  it("sets a percentage discount on an item", () => {
    store().addItem(makeProduct())
    store().setItemDiscount("product-1", { type: "percentage", value: 10 })

    expect(store().itemDiscounts["product-1"]).toEqual({
      type: "percentage",
      value: 10,
    })
  })

  it("removes discount when value is 0 or negative", () => {
    store().addItem(makeProduct())
    store().setItemDiscount("product-1", { type: "fixed", value: 500 })
    store().setItemDiscount("product-1", { type: "fixed", value: 0 })

    expect(store().itemDiscounts["product-1"]).toBeUndefined()
  })

  it("removes discount when null is passed", () => {
    store().addItem(makeProduct())
    store().setItemDiscount("product-1", { type: "fixed", value: 500 })
    store().setItemDiscount("product-1", null)

    expect(store().itemDiscounts["product-1"]).toBeUndefined()
  })
})

describe("getItemDiscountAmount", () => {
  it("returns 0 when no discount is set", () => {
    store().addItem(makeProduct({ sell_price: 10000 }))
    expect(store().getItemDiscountAmount("product-1")).toBe(0)
  })

  it("calculates fixed discount correctly", () => {
    store().addItem(makeProduct({ sell_price: 10000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 2000 })
    // qty=1, lineTotal=10000, discount=min(2000, 10000)=2000
    expect(store().getItemDiscountAmount("product-1")).toBe(2000)
  })

  it("caps fixed discount at line total", () => {
    store().addItem(makeProduct({ sell_price: 1000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 5000 })
    // discount = min(5000, 1000) = 1000
    expect(store().getItemDiscountAmount("product-1")).toBe(1000)
  })

  it("calculates percentage discount correctly", () => {
    store().addItem(makeProduct({ sell_price: 10000 }))
    store().setItemDiscount("product-1", { type: "percentage", value: 15 })
    // 10000 * 15 / 100 = 1500
    expect(store().getItemDiscountAmount("product-1")).toBe(1500)
  })

  it("accounts for quantity in discount calculation", () => {
    store().addItem(makeProduct({ sell_price: 5000 }))
    store().updateQuantity("product-1", 3)
    store().setItemDiscount("product-1", { type: "percentage", value: 10 })
    // lineTotal = 5000 * 3 = 15000, discount = 15000 * 10 / 100 = 1500
    expect(store().getItemDiscountAmount("product-1")).toBe(1500)
  })
})

// =====================================================================
// Discounts — transaction level
// =====================================================================

describe("setTransactionDiscount", () => {
  it("sets a transaction-level discount", () => {
    store().setTransactionDiscount({ type: "fixed", value: 5000 })
    expect(store().transactionDiscount).toEqual({ type: "fixed", value: 5000 })
  })

  it("clears discount when value is 0", () => {
    store().setTransactionDiscount({ type: "fixed", value: 5000 })
    store().setTransactionDiscount({ type: "fixed", value: 0 })
    expect(store().transactionDiscount).toBeNull()
  })

  it("clears discount when null is passed", () => {
    store().setTransactionDiscount({ type: "percentage", value: 5 })
    store().setTransactionDiscount(null)
    expect(store().transactionDiscount).toBeNull()
  })
})

describe("getTransactionDiscountAmount", () => {
  it("returns 0 when no transaction discount is set", () => {
    store().addItem(makeProduct({ sell_price: 10000 }))
    expect(store().getTransactionDiscountAmount()).toBe(0)
  })

  it("calculates fixed transaction discount on subtotal after item discounts", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 2000 })
    store().setTransactionDiscount({ type: "fixed", value: 3000 })
    // subtotal=10000, itemDisc=2000, afterItemDisc=8000
    // txnDisc = min(3000, 8000) = 3000
    expect(store().getTransactionDiscountAmount()).toBe(3000)
  })

  it("calculates percentage transaction discount on subtotal after item discounts", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 20000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 5000 })
    store().setTransactionDiscount({ type: "percentage", value: 10 })
    // subtotal=20000, itemDisc=5000, afterItemDisc=15000
    // txnDisc = round(15000 * 10 / 100) = 1500
    expect(store().getTransactionDiscountAmount()).toBe(1500)
  })

  it("caps fixed transaction discount at afterItemDisc value", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 5000 }))
    store().setTransactionDiscount({ type: "fixed", value: 99999 })
    // afterItemDisc=5000, min(99999, 5000)=5000
    expect(store().getTransactionDiscountAmount()).toBe(5000)
  })
})

describe("clearDiscounts", () => {
  it("clears all item and transaction discounts", () => {
    store().addItem(makeProduct({ id: 1 }))
    store().addItem(makeProduct({ id: 2 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 500 })
    store().setItemDiscount("product-2", { type: "percentage", value: 10 })
    store().setTransactionDiscount({ type: "fixed", value: 1000 })

    store().clearDiscounts()

    expect(store().itemDiscounts).toEqual({})
    expect(store().transactionDiscount).toBeNull()
  })
})

// =====================================================================
// getCartTotals — the core calculation
// =====================================================================

describe("getCartTotals", () => {
  it("returns zeros for empty cart", () => {
    const totals = store().getCartTotals()
    expect(totals).toEqual({ subtotal: 0, totalDiscount: 0, total: 0 })
  })

  it("calculates subtotal for single item", () => {
    store().addItem(makeProduct({ sell_price: 3000 }))
    const { subtotal, total } = store().getCartTotals()
    expect(subtotal).toBe(3000)
    expect(total).toBe(3000)
  })

  it("calculates subtotal for multiple items", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 3000 }))
    store().addItem(makeProduct({ id: 2, sell_price: 5000 }))
    const { subtotal } = store().getCartTotals()
    expect(subtotal).toBe(8000)
  })

  it("multiplies price by quantity", () => {
    store().addItem(makeProduct({ sell_price: 2500 }))
    store().updateQuantity("product-1", 4)
    const { subtotal } = store().getCartTotals()
    expect(subtotal).toBe(10000)
  })

  it("applies fixed item discount correctly", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 2000 })

    const totals = store().getCartTotals()
    expect(totals.subtotal).toBe(10000)
    expect(totals.totalDiscount).toBe(2000)
    expect(totals.total).toBe(8000)
  })

  it("applies percentage item discount correctly", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    store().setItemDiscount("product-1", { type: "percentage", value: 25 })

    const totals = store().getCartTotals()
    expect(totals.subtotal).toBe(10000)
    expect(totals.totalDiscount).toBe(2500)
    expect(totals.total).toBe(7500)
  })

  it("applies transaction discount after item discounts", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 20000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 5000 })
    store().setTransactionDiscount({ type: "percentage", value: 10 })

    const totals = store().getCartTotals()
    // subtotal=20000, itemDisc=5000, afterItemDisc=15000
    // txnDisc = round(15000 * 10/100) = 1500
    // totalDiscount = 5000 + 1500 = 6500
    // total = 20000 - 6500 = 13500
    expect(totals.subtotal).toBe(20000)
    expect(totals.totalDiscount).toBe(6500)
    expect(totals.total).toBe(13500)
  })

  it("applies multiple item discounts and transaction discount together", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    store().addItem(makeProduct({ id: 2, sell_price: 8000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 1000 })
    store().setItemDiscount("product-2", { type: "percentage", value: 25 })
    store().setTransactionDiscount({ type: "fixed", value: 2000 })

    const totals = store().getCartTotals()
    // subtotal = 10000 + 8000 = 18000
    // item1 disc = min(1000, 10000) = 1000
    // item2 disc = round(8000 * 25/100) = 2000
    // itemDiscTotal = 3000
    // afterItemDisc = 18000 - 3000 = 15000
    // txnDisc = min(2000, 15000) = 2000
    // totalDiscount = 3000 + 2000 = 5000
    // total = 18000 - 5000 = 13000
    expect(totals.subtotal).toBe(18000)
    expect(totals.totalDiscount).toBe(5000)
    expect(totals.total).toBe(13000)
  })

  it("total never goes below zero", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 1000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 500 })
    store().setTransactionDiscount({ type: "fixed", value: 99999 })

    const totals = store().getCartTotals()
    expect(totals.total).toBeGreaterThanOrEqual(0)
  })

  it("handles quantity in discount calculation", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 5000 }))
    store().updateQuantity("product-1", 3)
    store().setItemDiscount("product-1", { type: "percentage", value: 10 })

    const totals = store().getCartTotals()
    // subtotal = 5000 * 3 = 15000
    // disc = round(15000 * 10/100) = 1500
    expect(totals.subtotal).toBe(15000)
    expect(totals.totalDiscount).toBe(1500)
    expect(totals.total).toBe(13500)
  })
})

// =====================================================================
// Convenience getters
// =====================================================================

describe("getSubtotal / getTotal / getTotalDiscount", () => {
  it("getSubtotal returns same as getCartTotals().subtotal", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 7500 }))
    store().addItem(makeProduct({ id: 2, sell_price: 2500 }))

    expect(store().getSubtotal()).toBe(10000)
    expect(store().getSubtotal()).toBe(store().getCartTotals().subtotal)
  })

  it("getTotal returns same as getCartTotals().total", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 3000 })

    expect(store().getTotal()).toBe(7000)
    expect(store().getTotal()).toBe(store().getCartTotals().total)
  })

  it("getTotalDiscount returns same as getCartTotals().totalDiscount", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 3000 })

    expect(store().getTotalDiscount()).toBe(3000)
    expect(store().getTotalDiscount()).toBe(store().getCartTotals().totalDiscount)
  })
})

// =====================================================================
// getItemDiscountsTotal
// =====================================================================

describe("getItemDiscountsTotal", () => {
  it("returns 0 when no item discounts", () => {
    store().addItem(makeProduct({ sell_price: 5000 }))
    expect(store().getItemDiscountsTotal()).toBe(0)
  })

  it("sums all item discounts", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    store().addItem(makeProduct({ id: 2, sell_price: 8000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 1000 })
    store().setItemDiscount("product-2", { type: "percentage", value: 25 })

    // item1: min(1000, 10000) = 1000
    // item2: round(8000 * 25/100) = 2000
    expect(store().getItemDiscountsTotal()).toBe(3000)
  })
})

// =====================================================================
// holdCart / recallCart / removeHeldCart
// =====================================================================

describe("holdCart", () => {
  it("holds current cart and clears active cart", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 3000 }))
    store().addItem(makeProduct({ id: 2, sell_price: 5000 }))

    store().holdCart("Pelanggan A")

    expect(store().items).toHaveLength(0)
    expect(store().heldCarts).toHaveLength(1)
    expect(store().heldCarts[0].label).toBe("Pelanggan A")
    expect(store().heldCarts[0].items).toHaveLength(2)
    expect(store().heldCarts[0].total).toBe(8000) // 3000 + 5000
  })

  it("auto-generates label if none provided", () => {
    store().addItem(makeProduct())
    store().holdCart()

    expect(store().heldCarts[0].label).toBe("Pelanggan 1")
  })

  it("auto-generates sequential labels", () => {
    store().addItem(makeProduct({ id: 1 }))
    store().holdCart("First")

    store().addItem(makeProduct({ id: 2 }))
    store().holdCart()

    expect(store().heldCarts[1].label).toBe("Pelanggan 2")
  })

  it("does nothing if cart is empty", () => {
    store().holdCart("Empty")
    expect(store().heldCarts).toHaveLength(0)
  })
})

describe("recallCart", () => {
  it("recalls a held cart when active cart is empty", () => {
    store().addItem(makeProduct({ id: 1, name: "Held Item" }))
    store().holdCart("Test")
    const holdId = store().heldCarts[0].id

    expect(store().items).toHaveLength(0)

    store().recallCart(holdId)

    expect(store().items).toHaveLength(1)
    expect(store().items[0].product_name).toBe("Held Item")
    expect(store().heldCarts).toHaveLength(0)
  })

  it("swaps current cart with held cart when active cart has items", () => {
    store().addItem(makeProduct({ id: 1, name: "Held Item" }))
    store().holdCart("Held")
    const holdId = store().heldCarts[0].id

    store().addItem(makeProduct({ id: 2, name: "Active Item" }))

    store().recallCart(holdId)

    // Active cart now has the recalled items
    expect(store().items).toHaveLength(1)
    expect(store().items[0].product_name).toBe("Held Item")

    // The previously active cart is now held
    expect(store().heldCarts).toHaveLength(1)
    expect(store().heldCarts[0].label).toBe("Keranjang Aktif")
    expect(store().heldCarts[0].items[0].product_name).toBe("Active Item")
  })

  it("does nothing for invalid holdId", () => {
    store().addItem(makeProduct())
    store().holdCart()

    store().recallCart("nonexistent")

    expect(store().items).toHaveLength(0)
    expect(store().heldCarts).toHaveLength(1)
  })
})

describe("removeHeldCart", () => {
  it("removes a held cart by id", () => {
    vi.useFakeTimers()

    store().addItem(makeProduct({ id: 1 }))
    store().holdCart("A")

    vi.advanceTimersByTime(10) // ensure different Date.now() → different hold id

    store().addItem(makeProduct({ id: 2 }))
    store().holdCart("B")

    expect(store().heldCarts).toHaveLength(2)

    const firstHoldId = store().heldCarts[0].id
    store().removeHeldCart(firstHoldId)

    expect(store().heldCarts).toHaveLength(1)
    expect(store().heldCarts[0].label).toBe("B")

    vi.useRealTimers()
  })

  it("does nothing for invalid holdId", () => {
    store().addItem(makeProduct())
    store().holdCart()
    store().removeHeldCart("nonexistent")
    expect(store().heldCarts).toHaveLength(1)
  })
})

// =====================================================================
// Discounts belong to a single cart
// =====================================================================

describe("discount scoping between carts", () => {
  it("stores the discounts together with the held cart", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 1000 })
    store().setTransactionDiscount({ type: "percentage", value: 50 })

    store().holdCart("Pelanggan 1")

    const [held] = store().heldCarts
    expect(held.itemDiscounts["product-1"]).toEqual({ type: "fixed", value: 1000 })
    expect(held.transactionDiscount).toEqual({ type: "percentage", value: 50 })
  })

  it("does not leak the held cart discounts to the next customer", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    store().setTransactionDiscount({ type: "percentage", value: 50 })
    store().holdCart("Pelanggan 1")

    expect(store().itemDiscounts).toEqual({})
    expect(store().transactionDiscount).toBeNull()

    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    expect(store().getCartTotals().total).toBe(10000)
  })

  it("counts the discount in the held cart total", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    store().setTransactionDiscount({ type: "percentage", value: 50 })

    store().holdCart("Pelanggan 1")

    expect(store().heldCarts[0].total).toBe(5000)
  })

  it("restores the discounts of the recalled cart", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 1000 })
    store().setTransactionDiscount({ type: "percentage", value: 50 })
    store().holdCart("Pelanggan 1")

    const holdId = store().heldCarts[0].id
    store().recallCart(holdId)

    expect(store().itemDiscounts["product-1"]).toEqual({ type: "fixed", value: 1000 })
    expect(store().transactionDiscount).toEqual({ type: "percentage", value: 50 })
    expect(store().getCartTotals().total).toBe(4500)
  })

  it("keeps each cart's discounts when two carts are swapped", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    store().setTransactionDiscount({ type: "percentage", value: 50 })
    store().holdCart("Pelanggan 1")
    const holdId = store().heldCarts[0].id

    store().addItem(makeProduct({ id: 2, sell_price: 20000 }))
    store().setTransactionDiscount({ type: "fixed", value: 2000 })

    store().recallCart(holdId)

    // Cart 1 is active again with its own 50% discount
    expect(store().transactionDiscount).toEqual({ type: "percentage", value: 50 })
    expect(store().getCartTotals().total).toBe(5000)

    // Cart 2 kept its own fixed discount while held
    const swapped = store().heldCarts[0]
    expect(swapped.transactionDiscount).toEqual({ type: "fixed", value: 2000 })
    expect(swapped.total).toBe(18000)
  })

  it("keeps held cart discounts when the active cart is cleared", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    store().setTransactionDiscount({ type: "percentage", value: 50 })
    store().holdCart("Pelanggan 1")

    store().addItem(makeProduct({ id: 2, sell_price: 20000 }))
    store().clear()

    expect(store().heldCarts[0].transactionDiscount).toEqual({
      type: "percentage",
      value: 50,
    })
  })

  it("recalls a legacy held cart that has no stored discounts", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 10000 }))
    store().holdCart("Legacy")
    const [held] = store().heldCarts
    useCartStore.setState({
      heldCarts: [
        {
          id: held.id,
          label: held.label,
          items: held.items,
          total: held.total,
          heldAt: held.heldAt,
        } as HeldCart,
      ],
    })

    store().recallCart(held.id)

    expect(store().items).toHaveLength(1)
    expect(store().itemDiscounts).toEqual({})
    expect(store().transactionDiscount).toBeNull()
  })
})

// =====================================================================
// Mixed cart (regular + PPOB)
// =====================================================================

describe("mixed cart with regular and PPOB items", () => {
  it("calculates totals correctly with both item types", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 3000 }))
    store().updateQuantity("product-1", 2)
    store().addPpobItem({
      name: "Pulsa",
      price: 50000,
      service_type: "pulsa",
      service_ref: "08123",
    })

    const { subtotal } = store().getCartTotals()
    // 3000 * 2 + 50000 = 56000
    expect(subtotal).toBe(56000)
  })

  it("addItem does not merge with PPOB items even if they exist", () => {
    store().addPpobItem({
      name: "Token PLN",
      price: 100000,
      service_type: "pln",
      service_ref: "x",
    })
    store().addItem(makeProduct({ id: 1 }))
    store().addItem(makeProduct({ id: 1 }))

    expect(store().items).toHaveLength(2) // 1 PPOB + 1 regular (merged)
    const regularItem = store().items.find((i) => !i.is_ppob)
    expect(regularItem?.quantity).toBe(2)
  })
})

// =====================================================================
// Edge cases
// =====================================================================

describe("edge cases", () => {
  it("handles zero-price products", () => {
    store().addItem(makeProduct({ sell_price: 0 }))
    expect(store().getCartTotals().subtotal).toBe(0)
    expect(store().getCartTotals().total).toBe(0)
  })

  it("handles very large quantities", () => {
    store().addItem(makeProduct({ sell_price: 500 }))
    store().updateQuantity("product-1", 9999)

    const { subtotal } = store().getCartTotals()
    expect(subtotal).toBe(500 * 9999)
  })

  it("handles percentage discount rounding", () => {
    store().addItem(makeProduct({ id: 1, sell_price: 3333 }))
    store().setItemDiscount("product-1", { type: "percentage", value: 33 })

    // 3333 * 33 / 100 = 1099.89 → round → 1100
    const disc = store().getItemDiscountAmount("product-1")
    expect(disc).toBe(Math.round(3333 * 33 / 100))
  })
})

describe("persisted cart migration", () => {
  it("drops PPOB rows whose inquiry has gone stale", () => {
    const migrated = migrateCartState(
      {
        items: [
          { cart_id: "product-1", product_name: "Beras", quantity: 1 },
          { cart_id: "ppob-1", product_name: "Token PLN", quantity: 1, is_ppob: true },
        ],
        ppobCounter: 1,
        heldCarts: [],
        itemDiscounts: {},
        transactionDiscount: null,
      },
      1
    )

    expect(migrated.items.map((i) => i.cart_id)).toEqual(["product-1"])
  })

  it("drops PPOB rows inside held carts too", () => {
    const migrated = migrateCartState(
      {
        items: [],
        heldCarts: [
          {
            id: "hold-1",
            label: "Pak Budi",
            items: [{ cart_id: "ppob-1", is_ppob: true }, { cart_id: "product-2" }],
            itemDiscounts: {},
            transactionDiscount: null,
            total: 0,
            heldAt: 0,
          },
        ],
      },
      1
    )

    expect(migrated.heldCarts[0].items.map((i) => i.cart_id)).toEqual(["product-2"])
  })

  it("discards pre-v1 global discounts that used to leak between carts", () => {
    const migrated = migrateCartState(
      {
        items: [{ cart_id: "product-1" }],
        itemDiscounts: { "product-1": { type: "percentage", value: 50 } },
        transactionDiscount: { type: "fixed", value: 5000 },
      },
      0
    )

    expect(migrated.itemDiscounts).toEqual({})
    expect(migrated.transactionDiscount).toBeNull()
  })

  it("keeps discounts once they are already scoped per cart", () => {
    const migrated = migrateCartState(
      {
        items: [{ cart_id: "product-1" }],
        itemDiscounts: { "product-1": { type: "fixed", value: 1000 } },
        transactionDiscount: null,
      },
      1
    )

    expect(migrated.itemDiscounts).toEqual({
      "product-1": { type: "fixed", value: 1000 },
    })
  })

  it("tolerates a completely empty persisted payload", () => {
    const migrated = migrateCartState(undefined, 0)

    expect(migrated.items).toEqual([])
    expect(migrated.heldCarts).toEqual([])
    expect(migrated.ppobCounter).toBe(0)
  })
})

// =====================================================================
// checkout key (Idempotency-Key)
// =====================================================================

/**
 * The key's lifetime is the whole of what makes it useful.
 *
 * Over IPC a checkout either happened or it did not. Over HTTP there is a third
 * outcome — the sale committed and the reply was lost on shop wifi — and a
 * retry from that state is indistinguishable from a request that never arrived.
 * One key per cart, reused by every attempt at that cart, is what lets the
 * server tell the two apart. A key per retry would defeat it entirely; a key
 * per cashier session would make the second genuine sale of the day come back
 * as a replay of the first.
 */
describe("checkout key", () => {
  it("is absent until the first checkout attempt", () => {
    store().addItem(makeProduct())

    expect(store().checkoutKey).toBeNull()
  })

  it("keeps the same key across retries of the same cart", () => {
    store().addItem(makeProduct())

    const first = store().getCheckoutKey()

    expect(store().getCheckoutKey()).toBe(first)
    expect(store().getCheckoutKey()).toBe(first)
  })

  /**
   * A failed attempt releases the key on the server, so correcting the cart and
   * trying again under the same key is allowed — and is what a cashier does
   * after "stok tidak cukup".
   */
  it("survives the cart being edited after a failed attempt", () => {
    store().addItem(makeProduct())
    const key = store().getCheckoutKey()

    store().addItem(makeProduct({ id: 2, name: "Gula Pasir" }))
    store().updateQuantity(store().items[0].cart_id, 3)

    expect(store().getCheckoutKey()).toBe(key)
  })

  it("starts a new key once the cart is emptied", () => {
    store().addItem(makeProduct())
    const first = store().getCheckoutKey()

    store().clear()
    store().addItem(makeProduct())

    expect(store().checkoutKey).toBeNull()
    expect(store().getCheckoutKey()).not.toBe(first)
  })

  it("starts a new key when the cart is held for another customer", () => {
    store().addItem(makeProduct())
    const first = store().getCheckoutKey()

    store().holdCart("Pelanggan A")
    store().addItem(makeProduct({ id: 2 }))

    expect(store().getCheckoutKey()).not.toBe(first)
  })

  it("starts a new key when a held cart is recalled", () => {
    store().addItem(makeProduct())
    store().holdCart("Pelanggan A")
    store().addItem(makeProduct({ id: 2 }))
    const active = store().getCheckoutKey()

    store().recallCart(store().heldCarts[0].id)

    expect(store().getCheckoutKey()).not.toBe(active)
  })

  /**
   * A reload in the middle of a checkout is exactly the case the key exists
   * for: the cart comes back from `localStorage`, and so must the key that
   * stops it being rung up a second time.
   */
  it("is carried through a persisted cart", () => {
    const migrated = migrateCartState(
      {
        items: [{ cart_id: "product-1" }],
        ppobCounter: 0,
        heldCarts: [],
        itemDiscounts: {},
        transactionDiscount: null,
        checkoutKey: "kunci-tersimpan",
      },
      1
    )

    expect(migrated.checkoutKey).toBe("kunci-tersimpan")
  })

  it("defaults to no key for carts persisted before it existed", () => {
    expect(migrateCartState({ items: [] }, 1).checkoutKey).toBeNull()
    expect(migrateCartState(undefined, 0).checkoutKey).toBeNull()
  })
})

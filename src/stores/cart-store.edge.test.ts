import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { heldCartTotal, useCartStore, type HeldCart } from "@/stores/cart-store"
import {
  cartLineNets,
  computeCartTotals,
  discountAmount,
  normalizeDiscount,
} from "@/stores/cart-totals"

/**
 * Edge cases of the cart the cashier screen leans on: the same barcode twice,
 * discounts at their limits, removing the last line, held carts that go
 * through a reload, and a different user taking the till.
 */

function product(
  overrides: Partial<{
    id: number
    name: string
    sell_price: number
    stock: number
    unit: string
  }> = {},
) {
  return { id: 1, name: "Indomie Goreng", sell_price: 3000, stock: 100, unit: "pcs", ...overrides }
}

function store() {
  return useCartStore.getState()
}

beforeEach(() => {
  useCartStore.setState({
    items: [],
    ppobCounter: 0,
    heldCarts: [],
    itemDiscounts: {},
    transactionDiscount: null,
    checkoutKey: null,
    ownerId: null,
  })
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.removeItem("kasir-cart")
})

describe("scanning the same barcode twice", () => {
  it("moves a re-scanned line to the top instead of adding a second row", () => {
    store().addItem(product({ id: 1, name: "Indomie" }))
    store().addItem(product({ id: 2, name: "Beras" }))
    store().addItem(product({ id: 1, name: "Indomie" }))

    expect(store().items.map((item) => [item.product_id, item.quantity])).toEqual([
      [1, 2],
      [2, 1],
    ])
  })

  it("keeps a line discount on the line when its quantity grows by a scan", () => {
    store().addItem(product())
    store().setItemDiscount("product-1", { type: "percentage", value: 10 })

    store().addItem(product())

    // 2 × 3.000 = 6.000, 10% off = 600.
    expect(store().getItemDiscountAmount("product-1")).toBe(600)
    expect(store().getTotal()).toBe(5400)
  })

  // A re-scan is the only repricing a one-line cart gets: the background check
  // keys on the cart's product ids, which a quantity bump does not change.
  it("takes the current price from a re-scan of a line already in the cart", () => {
    expect(store().addItem(product({ sell_price: 3000 }))).toBeNull()

    // The catalogue price went up; the scanner's lookup returns the new one.
    expect(store().addItem(product({ sell_price: 3500, stock: 40 }), { fresh: true })).toEqual({
      name: "Indomie Goreng",
      from: 3000,
      to: 3500,
    })

    const [line] = store().items
    expect(line.quantity).toBe(2)
    expect(line.product_price).toBe(3500)
    expect(line.stock).toBe(40)
    expect(store().getTotal()).toBe(7000)
  })

  // A tile or a search row may be a cached copy from before the price went up:
  // tapping it again must not roll the line back to the old price.
  it("keeps the line's price when the same product comes from cached data", () => {
    store().addItem(product({ sell_price: 3500, stock: 40 }), { fresh: true })

    expect(store().addItem(product({ sell_price: 3000, stock: 90 }))).toBeNull()

    const [line] = store().items
    expect(line.quantity).toBe(2)
    expect(line.product_price).toBe(3500)
    expect(line.stock).toBe(40)
  })
})

describe("discounts at the edges", () => {
  it("never lets a 100% line discount plus a transaction discount push the total below zero", () => {
    store().addItem(product({ id: 1, sell_price: 5000 }))
    store().addItem(product({ id: 2, sell_price: 2000 }))
    store().setItemDiscount("product-1", { type: "percentage", value: 100 })
    store().setTransactionDiscount({ type: "fixed", value: 999_999 })

    const totals = store().getCartTotals()
    expect(totals.subtotal).toBe(7000)
    expect(totals.itemDiscountsTotal).toBe(5000)
    // Clamped to what the line discount left: 2.000.
    expect(totals.transactionDiscountAmount).toBe(2000)
    expect(totals.total).toBe(0)
  })

  it("re-caps a saved fixed line discount when the quantity drops below it", () => {
    store().addItem(product({ sell_price: 10_000 }))
    store().updateQuantity("product-1", 3)
    store().setItemDiscount("product-1", { type: "fixed", value: 25_000 })

    store().updateQuantity("product-1", 1)

    expect(store().getItemDiscountAmount("product-1")).toBe(10_000)
    expect(store().getTotal()).toBe(0)
  })

  it("caps a fixed transaction discount at what is left after a line is removed", () => {
    store().addItem(product({ id: 1, sell_price: 10_000 }))
    store().addItem(product({ id: 2, sell_price: 5_000 }))
    store().setTransactionDiscount({ type: "fixed", value: 12_000 })

    store().removeItem("product-1")

    expect(store().getTransactionDiscountAmount()).toBe(5_000)
    expect(store().getTotal()).toBe(0)
  })

  it("treats a negative or NaN discount as no discount", () => {
    store().addItem(product())

    store().setItemDiscount("product-1", { type: "fixed", value: -500 })
    store().setTransactionDiscount({ type: "percentage", value: Number.NaN })

    expect(store().itemDiscounts).toEqual({})
    expect(store().transactionDiscount).toBeNull()
    expect(store().getTotal()).toBe(3000)
  })

  it("rounds a percentage line discount to whole rupiah", () => {
    store().addItem(product({ sell_price: 3333 }))
    store().setItemDiscount("product-1", { type: "percentage", value: 15 })

    // 3.333 × 15% = 499,95 → 500.
    expect(store().getItemDiscountAmount("product-1")).toBe(500)
    expect(store().getTotal()).toBe(2833)
  })

  it("normalizeDiscount drops a value that rounds to nothing and keeps the type", () => {
    expect(normalizeDiscount({ type: "fixed", value: 0 }, 1000)).toEqual({
      entry: null,
      capped: false,
    })
    expect(normalizeDiscount({ type: "fixed", value: 500 }, 0)).toEqual({
      entry: null,
      capped: true,
    })
    expect(normalizeDiscount({ type: "percentage", value: 250 }, 0)).toEqual({
      entry: { type: "percentage", value: 100 },
      capped: true,
    })
  })

  it("discountAmount never takes a fixed amount above its base", () => {
    expect(discountAmount(4000, { type: "fixed", value: 10_000 })).toBe(4000)
    expect(discountAmount(0, { type: "percentage", value: 50 })).toBe(0)
  })

  it("cartLineNets spreads the cart discount in whole rupiah, as the server does", () => {
    const line = (cart_id: string, product_price: number) => ({
      cart_id,
      product_name: cart_id,
      product_price,
      quantity: 1,
      stock: 10,
      unit: "pcs",
    })
    const lines = [line("a", 10_000), line("b", 10_000), line("c", 10_000)]

    // The same cases as `prorated_line_nets` in checkout/discounts.rs.
    expect(cartLineNets(lines, {}, { type: "fixed", value: 10_000 })).toEqual([6_667, 6_667, 6_666])
    expect(
      cartLineNets(
        [line("a", 20_000), line("b", 6_000)],
        { a: { type: "fixed", value: 2_000 } },
        { type: "fixed", value: 6_000 },
      ),
    ).toEqual([13_500, 4_500])
    expect(cartLineNets([line("a", 12_000)], {}, { type: "fixed", value: 5_000 })).toEqual([7_000])
    expect(
      cartLineNets([line("a", 20_000)], { a: { type: "percentage", value: 100 } }, null),
    ).toEqual([0])
    // No cart discount: a fractional price stays on its own line.
    expect(cartLineNets([line("a", 1_250.5), line("b", 12_000)], {}, null)).toEqual([
      1_250.5, 12_000,
    ])
    // A free line is never rounded up, and the half rupiah goes up onto the
    // line furthest below its share, not off the largest line.
    expect(
      cartLineNets(
        [line("a", 1_000.5), line("b", 12_000), line("c", 5_000)],
        { c: { type: "percentage", value: 100 } },
        { type: "fixed", value: 1_000 },
      ),
    ).toEqual([923.5, 11_077, 0])
    expect(
      cartLineNets(
        [line("a", 0), line("b", 10_000), line("c", 10_000)],
        {},
        { type: "fixed", value: 10_000 },
      ),
    ).toEqual([0, 5_000, 5_000])
  })

  it("computeCartTotals ignores a discount whose line is gone", () => {
    const totals = computeCartTotals(
      [
        {
          cart_id: "product-1",
          product_id: 1,
          product_name: "Indomie",
          product_price: 3000,
          quantity: 1,
          stock: 10,
          unit: "pcs",
        },
      ],
      { "product-9": { type: "fixed", value: 3000 } },
      null,
    )
    expect(totals.total).toBe(3000)
    expect(totals.totalDiscount).toBe(0)
  })
})

describe("removing the last item", () => {
  it("ends the sale even when the last line was removed after a failed checkout", () => {
    store().addItem(product())
    store().setItemDiscount("product-1", { type: "fixed", value: 500 })
    store().setTransactionDiscount({ type: "percentage", value: 10 })
    const firstKey = store().getCheckoutKey()

    store().removeItem("product-1")
    store().addItem(product({ id: 2, name: "Beras" }))

    expect(store().itemDiscounts).toEqual({})
    expect(store().transactionDiscount).toBeNull()
    expect(store().getCheckoutKey()).not.toBe(firstKey)
  })

  it("keeps the held carts when the active cart's last line goes", () => {
    store().addItem(product({ id: 1 }))
    store().holdCart("Bu Sri")
    store().addItem(product({ id: 2 }))

    store().removeItem("product-2")

    expect(store().items).toEqual([])
    expect(store().heldCarts.map((cart) => cart.label)).toEqual(["Bu Sri"])
  })
})

describe("hold and recall", () => {
  it("parks the active cart, its discounts and all, when another cart is recalled", () => {
    store().addItem(product({ id: 1, sell_price: 10_000 }))
    store().setTransactionDiscount({ type: "fixed", value: 1_000 })
    store().holdCart("Pak Budi")
    store().addItem(product({ id: 2, sell_price: 4_000 }))
    store().setItemDiscount("product-2", { type: "percentage", value: 50 })

    store().recallCart(store().heldCarts[0].id)

    expect(store().items.map((item) => item.product_id)).toEqual([1])
    expect(store().getTotal()).toBe(9_000)
    const [parked] = store().heldCarts
    expect(parked.label).toBe("Pelanggan 1")
    expect(heldCartTotal(parked)).toBe(2_000)
  })

  it("ignores a hold of an empty cart without touching the checkout key", () => {
    store().holdCart("Kosong")

    expect(store().heldCarts).toEqual([])
  })

  // Counting only the carts waiting would call two of them "Pelanggan 2" once
  // one was recalled, and the cashier could recall the wrong one from F9.
  it("gives every waiting cart a distinct automatic name, also after a recall", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    store().addItem(product({ id: 1 }))
    store().holdCart() // Pelanggan 1
    vi.setSystemTime(2_000)
    store().addItem(product({ id: 2 }))
    store().holdCart() // Pelanggan 2

    vi.setSystemTime(3_000)
    store().recallCart(store().heldCarts[0].id) // Pelanggan 1 is served
    store().clear()
    vi.setSystemTime(4_000)
    store().addItem(product({ id: 3 }))
    store().holdCart() // a third customer

    const labels = store().heldCarts.map((cart) => cart.label)
    expect(labels).toEqual(["Pelanggan 2", "Pelanggan 3"])
  })

  // Every recall over a non-empty cart used to park it as "Keranjang Aktif",
  // so two swaps left two carts of that name in F9.
  it("parks each outgoing cart of a recall under its own name", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    store().addItem(product({ id: 1 }))
    store().holdCart("Bu Sri")
    vi.setSystemTime(2_000)
    store().addItem(product({ id: 2 }))
    store().holdCart("Pak Budi")
    store().addItem(product({ id: 3 }))

    vi.setSystemTime(3_000)
    const sri = store().heldCarts.find((cart) => cart.label === "Bu Sri")!
    const firstParked = store().recallCart(sri.id)
    vi.setSystemTime(4_000)
    const budi = store().heldCarts.find((cart) => cart.label === "Pak Budi")!
    const secondParked = store().recallCart(budi.id)

    const labels = store().heldCarts.map((cart) => cart.label)
    expect(labels).toEqual([firstParked, secondParked])
    expect(new Set(labels).size).toBe(2)
    expect(labels).toEqual(["Pelanggan 2", "Pelanggan 3"])
    expect(store().recallCart("missing")).toBeNull()
  })

  it("survives a reload with items, discounts and the label intact", async () => {
    store().addItem(product({ id: 1, sell_price: 10_000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 1_500 })
    store().setTransactionDiscount({ type: "percentage", value: 10 })
    store().holdCart("Bu Sri")
    const saved = localStorage.getItem("kasir-cart")
    expect(saved).not.toBeNull()

    // A new app session: the in-memory store is gone, localStorage is not.
    useCartStore.setState({ heldCarts: [], items: [] })
    localStorage.setItem("kasir-cart", saved as string)
    await useCartStore.persist.rehydrate()

    const [held] = store().heldCarts as HeldCart[]
    expect(held.label).toBe("Bu Sri")
    // 10.000 − 1.500 = 8.500, then 10% = 850 → 7.650.
    expect(heldCartTotal(held)).toBe(7_650)

    store().recallCart(held.id)
    expect(store().getTotal()).toBe(7_650)
    expect(store().checkoutKey).toBeNull()
  })

  it("restores the active cart and its checkout key after a reload mid-checkout", async () => {
    store().addItem(product())
    const key = store().getCheckoutKey()
    const saved = localStorage.getItem("kasir-cart") as string

    useCartStore.setState({ items: [], checkoutKey: null })
    localStorage.setItem("kasir-cart", saved)
    await useCartStore.persist.rehydrate()

    expect(store().items).toHaveLength(1)
    expect(store().getCheckoutKey()).toBe(key)
  })
})

describe("a different user taking the till", () => {
  it("empties the cart, its discounts and its key, but leaves the held carts waiting", () => {
    store().claimFor(1)
    store().addItem(product({ id: 1 }))
    store().holdCart("Bu Sri")
    store().addItem(product({ id: 2 }))
    store().setTransactionDiscount({ type: "fixed", value: 500 })
    store().getCheckoutKey()

    expect(store().claimFor(2)).toBe(true)

    expect(store().items).toEqual([])
    expect(store().transactionDiscount).toBeNull()
    expect(store().checkoutKey).toBeNull()
    expect(store().heldCarts.map((cart) => cart.label)).toEqual(["Bu Sri"])
    expect(store().ownerId).toBe(2)
  })

  it("hands the till back and forth without losing the owner", () => {
    store().claimFor(1)
    store().claimFor(2)
    store().addItem(product())

    expect(store().claimFor(2)).toBe(false)
    expect(store().items).toHaveLength(1)
    expect(store().claimFor(1)).toBe(true)
    expect(store().items).toEqual([])
  })

  it("keeps the owner through a reload", async () => {
    store().claimFor(7)
    store().addItem(product())
    const saved = localStorage.getItem("kasir-cart") as string

    useCartStore.setState({ ownerId: null, items: [] })
    localStorage.setItem("kasir-cart", saved)
    await useCartStore.persist.rehydrate()

    expect(store().ownerId).toBe(7)
    // Another user's login after the reload still finds a cart to empty.
    expect(store().claimFor(8)).toBe(true)
    expect(store().items).toEqual([])
  })
})

describe("repricing from the catalogue", () => {
  it("re-caps a fixed line discount when the price drops below it", () => {
    store().addItem(product({ sell_price: 10_000 }))
    store().setItemDiscount("product-1", { type: "fixed", value: 8_000 })

    store().applyLiveProducts(new Map([[1, { id: 1, sell_price: 5_000, stock: 9, unit: "pcs" }]]))

    expect(store().getItemDiscountAmount("product-1")).toBe(5_000)
    expect(store().getTotal()).toBe(0)
  })

  it("reports nothing and changes nothing when a product is missing from the catalogue", () => {
    store().addItem(product())
    const before = store().items

    const changes = store().applyLiveProducts(new Map())

    expect(changes).toEqual([])
    expect(store().items).toBe(before)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ProductLookup } from "@/features/products/types"
import { apiFailure, installApiMock } from "@/test-utils/api-mock"
import { useCartStore } from "@/stores/cart-store"
import { MAX_LOOKUP_IDS } from "@/lib/api/products"
import {
  notePricedByLookup,
  refreshCartPrices,
  resetCartPriceRefresh,
  takeUnacknowledgedPriceChanges,
} from "./cart-price-refresh"

const INDOMIE = { id: 1, name: "Indomie Goreng", sell_price: 3000, stock: 50, unit: "pcs" }

function live(sellPrice: number): ProductLookup {
  return { id: 1, sell_price: sellPrice, stock: 50, unit: "pcs", is_active: true }
}

function store() {
  return useCartStore.getState()
}

/** The cart of cashier 1 with Indomie repriced 3.000 → 3.500, not yet shown at payment. */
async function cartWithUnacknowledgedChange() {
  store().addItem(INDOMIE)
  installApiMock({ "GET /products/lookup": () => [live(3500)] })
  const changes = await refreshCartPrices()
  expect(changes).toEqual([{ name: "Indomie Goreng", from: 3000, to: 3500 }])
}

beforeEach(() => {
  resetCartPriceRefresh()
  useCartStore.setState({
    items: [],
    ppobCounter: 0,
    heldCarts: [],
    itemDiscounts: {},
    transactionDiscount: null,
    checkoutKey: null,
    ownerId: 1,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Logout clears the cart and the next login claims it while the cashier page
 * is not mounted. A price change left over from the cart before used to block
 * the next cashier's first F4 once, naming the old cart's product.
 */
describe("unacknowledged price changes across carts", () => {
  it("are dropped when the cart is cleared, as logout does", async () => {
    await cartWithUnacknowledgedChange()

    store().clear()
    // The next customer happens to buy the same product.
    store().addItem({ ...INDOMIE, sell_price: 3500 })

    expect(takeUnacknowledgedPriceChanges()).toEqual([])
  })

  it("are dropped when another cashier claims the till", async () => {
    await cartWithUnacknowledgedChange()

    expect(store().claimFor(2)).toBe(true)
    store().addItem({ ...INDOMIE, sell_price: 3500 })

    expect(takeUnacknowledgedPriceChanges()).toEqual([])
  })

  it("are kept for the same cart, and handed over once", async () => {
    await cartWithUnacknowledgedChange()

    expect(store().claimFor(1)).toBe(false)

    expect(takeUnacknowledgedPriceChanges()).toEqual([
      { name: "Indomie Goreng", from: 3000, to: 3500 },
    ])
    expect(takeUnacknowledgedPriceChanges()).toEqual([])
  })
})

/**
 * The server refuses more than `MAX_LOOKUP_IDS` ids per lookup. A first-visit
 * check over many held carts used to fail whole, so nothing was repriced.
 */
describe("a lookup over more products than one request takes", () => {
  it("is split into requests the server accepts, and every line is repriced", async () => {
    const count = MAX_LOOKUP_IDS + 1
    for (let productId = 1; productId <= count; productId++) {
      store().addItem({ ...INDOMIE, id: productId, name: `Produk ${productId}` })
    }
    const api = installApiMock({
      "GET /products/lookup": (call) => {
        const ids = (call.query.get("ids") ?? "").split(",").map(Number)
        if (ids.length > MAX_LOOKUP_IDS) {
          return apiFailure(400, "VALIDATION", "Paling banyak 500 produk sekali cek")
        }
        return ids.map((productId) => ({ ...live(3500), id: productId }))
      },
    })

    const changes = await refreshCartPrices()

    expect(api.callsFor("GET /products/lookup")).toHaveLength(2)
    expect(changes).toHaveLength(count)
    expect(store().items.every((item) => item.product_price === 3500)).toBe(true)
  })
})

/**
 * Only a fresh barcode lookup lets the check after a cart change skip a line,
 * and only for a moment: an old note must not hide a later price change.
 */
describe("lines priced by a barcode lookup", () => {
  it("are skipped right after the lookup, and checked again once the note is old", async () => {
    let now = 1_000_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    store().addItem(INDOMIE)
    notePricedByLookup(INDOMIE.id, INDOMIE.sell_price)
    const api = installApiMock({ "GET /products/lookup": () => [live(3500)] })

    expect(await refreshCartPrices({ skipLookupPriced: true })).toEqual([])
    expect(api.callsFor("GET /products/lookup")).toHaveLength(0)

    now += 60_000
    expect(await refreshCartPrices({ skipLookupPriced: true })).toEqual([
      { name: "Indomie Goreng", from: 3000, to: 3500 },
    ])
  })
})

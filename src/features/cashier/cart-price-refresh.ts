import { id } from "@/i18n/id"
import { lookupProducts } from "@/lib/api/products"
import { toast } from "@/lib/toast"
import { useCartStore, type LiveProduct, type PriceChange } from "@/stores/cart-store"
import type { CartItem } from "./types"
import { formatRupiah } from "./utils"

/**
 * The catalogue's current price, stock and unit for each product in `ids`, in
 * one request.
 *
 * A goods line is checked out by `product_id` alone (see `checkout-input.ts`),
 * so the server charges the catalogue's price of the moment, while a cart line
 * keeps the price it was added at — across a reload, and in a held cart.
 *
 * A product that is gone or deactivated is left out — checkout reports it.
 */
async function fetchLiveProducts(ids: Set<number>): Promise<Map<number, LiveProduct>> {
  const rows = await lookupProducts([...ids])
  return new Map(rows.filter((row) => row.is_active).map((row) => [row.id, row]))
}

interface RefreshOptions {
  /** Reprice the held carts too, so the recall dialog's totals are current. */
  includeHeld?: boolean
  /** Leave out lines still at the price a barcode lookup gave them moments ago. */
  skipLookupPriced?: boolean
}

/** The refresh in flight, shared by whoever asks while it runs. */
let pending: (Required<RefreshOptions> & { promise: Promise<PriceChange[]> }) | null = null

/** How long a barcode lookup's price counts as the catalogue's current one. */
const LOOKUP_PRICE_FRESH_MS = 5_000

/** Per product, the price the last barcode lookup showed, and when it answered. */
const lookupPrices = new Map<number, { price: number; at: number }>()

/**
 * Records that a barcode lookup just priced `productId`'s cart line at `price`.
 * Only for a fresh network answer: cached search results and shortcut tiles
 * may be stale, so the check after them must still run.
 */
export function notePricedByLookup(productId: number, price: number): void {
  lookupPrices.set(productId, { price, at: Date.now() })
}

function isFreshlyLookupPriced(productId: number, price: number): boolean {
  const noted = lookupPrices.get(productId)
  return (
    noted !== undefined && noted.price === price && Date.now() - noted.at < LOOKUP_PRICE_FRESH_MS
  )
}

function goodsIdsToCheck(lines: CartItem[], skipLookupPriced: boolean): Set<number> {
  const ids = new Set<number>()
  for (const { is_ppob, product_id, product_price } of lines) {
    if (is_ppob || product_id === undefined) continue
    if (skipLookupPriced && isFreshlyLookupPriced(product_id, product_price)) continue
    ids.add(product_id)
  }
  return ids
}

/**
 * Price changes found in the active cart that payment has not been held back
 * for yet. One line changed twice is kept as one change, from its first price
 * to its last.
 */
let unacknowledged: PriceChange[] = []

function rememberChanges(changes: PriceChange[]): void {
  for (const change of changes) {
    const earlier = unacknowledged.find((c) => c.name === change.name)
    unacknowledged = earlier
      ? unacknowledged.map((c) => (c === earlier ? { ...c, to: change.to } : c))
      : [...unacknowledged, change]
  }
  unacknowledged = unacknowledged.filter((c) => c.from !== c.to)
}

/**
 * Reprices the cart's goods lines from the catalogue and returns the price
 * changes in the active cart. Throws when the lookup fails. A call made while
 * a refresh is out joins it, unless it needs lines the one out leaves out.
 */
export function refreshCartPrices({
  includeHeld = false,
  skipLookupPriced = false,
}: RefreshOptions = {}): Promise<PriceChange[]> {
  if (
    pending &&
    (pending.includeHeld || !includeHeld) &&
    (!pending.skipLookupPriced || skipLookupPriced)
  ) {
    return pending.promise
  }

  const run = async () => {
    const { items, heldCarts } = useCartStore.getState()
    const lines = includeHeld ? [...items, ...heldCarts.flatMap((cart) => cart.items)] : items
    const ids = goodsIdsToCheck(lines, skipLookupPriced)
    if (ids.size === 0) return []

    const live = await fetchLiveProducts(ids)
    // Applied to the cart as it is now, not as it was when the lookup left:
    // the cashier may have scanned more in the meantime.
    const changes = useCartStore.getState().applyLiveProducts(live, { includeHeld })
    rememberChanges(changes)
    return changes
  }
  const promise = run().finally(() => {
    if (pending?.promise === promise) pending = null
  })
  pending = { includeHeld, skipLookupPriced, promise }
  return promise
}

function warnAboutChanges(refresh: Promise<PriceChange[]>): Promise<void> {
  return refresh.then((changes) => {
    if (changes.length > 0) toast.warning(priceChangeMessage(changes))
  })
}

/**
 * `refreshCartPrices` in the background: a moved price is toasted, a failed
 * lookup is not — it is no error worth a toast, the server prices the sale
 * anyway.
 */
export function refreshCartPricesInBackground(options?: RefreshOptions): void {
  warnAboutChanges(refreshCartPrices(options)).catch(() => {})
}

/** Whether the restored cart and the held carts were repriced this app session. */
let restoredCartChecked = false

/**
 * The cashier page's check on each visit: the restored cart and the held carts
 * the first time this app session (again after a failed try), the active cart
 * on every later visit — the catalogue may have been edited meanwhile.
 */
export function refreshCartOnVisit(): void {
  if (restoredCartChecked) {
    refreshCartPricesInBackground()
    return
  }
  restoredCartChecked = true
  warnAboutChanges(refreshCartPrices({ includeHeld: true })).catch(() => {
    restoredCartChecked = false
  })
}

/** The refresh in flight, if any — payment waits for it rather than racing it. */
export function cartPriceRefreshInFlight(): Promise<PriceChange[]> | null {
  return pending?.promise ?? null
}

/**
 * The price changes payment has not been held back for yet, handed over once:
 * the caller holds payment back for them, and the next attempt goes through.
 * Only lines still in the cart count: a removed line's new price is no
 * longer in the total.
 */
export function takeUnacknowledgedPriceChanges(): PriceChange[] {
  const changes = unacknowledged
  unacknowledged = []
  return changes
}

/** Drops the changes of lines no longer among `items` — all of them once the cart is emptied. */
function forgetPriceChangesOfRemovedLines(items: CartItem[]): void {
  const names = new Set(items.filter((item) => !item.is_ppob).map((item) => item.product_name))
  unacknowledged = unacknowledged.filter((change) => names.has(change.name))
}

/**
 * The changes follow the cart wherever it changes, the cashier page mounted or
 * not: all go when a different user claims it, and a line's go with the line.
 */
useCartStore.subscribe((state, previous) => {
  if (state.ownerId !== previous.ownerId) {
    unacknowledged = []
    return
  }
  if (state.items !== previous.items && unacknowledged.length > 0) {
    forgetPriceChangesOfRemovedLines(state.items)
  }
})

/** Test seam: forget the session's check, the refresh in flight, its changes and lookup prices. */
export function resetCartPriceRefresh(): void {
  restoredCartChecked = false
  pending = null
  unacknowledged = []
  lookupPrices.clear()
}

/** The toast for a repricing: the one line by name, several by count. */
export function priceChangeMessage(changes: PriceChange[]): string {
  if (changes.length === 1) {
    const [{ name, from, to }] = changes
    return id.cashier.priceChanged(name, formatRupiah(from), formatRupiah(to))
  }
  return id.cashier.pricesChanged(changes.length)
}

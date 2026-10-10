import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

const toastWarning = vi.fn()
const toastError = vi.fn()

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: (message: string) => toastError(message),
    warning: (message: string) => toastWarning(message),
  },
}))

import { apiFailure, installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { SETTINGS } from "@/test-utils/settings-fixture"
import { TestNavbar } from "@/test-utils/test-navbar"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { Product, ProductLookup } from "@/features/products/types"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useCartStore } from "@/stores/cart-store"
import { resetCartPriceRefresh } from "./cart-price-refresh"
import { CashierPage } from "./components/cashier-page"
import type { CartItem, TransactionResult } from "./types"
import { formatRupiah } from "./utils"

/**
 * The cashier page end to end: a scan, the cart, F4, the payment dialog and
 * the receipt — with the server mocked at the `fetch` boundary.
 */

const BARCODE = "8991234567890"

function cartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    cart_id: "product-1",
    product_id: 1,
    product_name: "Indomie Goreng",
    product_price: 3000,
    quantity: 1,
    stock: 50,
    unit: "pcs",
    ...overrides,
  }
}

/** The catalogue's price of product 1 right now. */
let livePrice = 3000

function scannedProduct(): Product {
  return {
    id: 1,
    barcode: BARCODE,
    sku: null,
    name: "Indomie Goreng",
    category_id: null,
    buy_price: 2500,
    sell_price: livePrice,
    margin: livePrice - 2500,
    stock: 50,
    unit: "pcs",
    min_stock: 5,
    is_active: true,
    created_at: null,
    updated_at: null,
  } as unknown as Product
}

function lookup(): ProductLookup[] {
  return [{ id: 1, sell_price: livePrice, stock: 50, unit: "pcs", is_active: true }]
}

function checkoutResult(id: number): TransactionResult {
  return {
    transaction: {
      id,
      receipt_number: `TRX-20261010-000${id}`,
      user_id: 1,
      total_amount: 3000,
      subtotal_amount: 3000,
      discount_amount: 0,
      payment_method: "cash",
      payment_amount: 5000,
      change_amount: 2000,
      status: "completed",
      channel: "sales",
      notes: null,
      deleted_at: null,
      deleted_by: null,
      deleted_reason: null,
      updated_at: null,
      created_at: "2026-10-10 01:00:00",
    },
    items: [],
    payment_breakdown: [],
  }
}

let api: ApiMock
let saleCount = 0

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TestNavbar>
          <CashierPage />
        </TestNavbar>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Rupiah as Testing Library reads it: the non-breaking space normalised away. */
function rupiah(amount: number) {
  return formatRupiah(amount).replace(/\s+/g, " ")
}

function scanField() {
  return screen.getByRole("combobox", { name: "Scan barcode atau cari produk" })
}

/** A scanner: the whole code typed at once (the lookup needs no timing), then Enter. */
function scan(barcode: string) {
  const field = scanField()
  fireEvent.change(field, { target: { value: barcode } })
  fireEvent.keyDown(field, { key: "Enter" })
}

async function openPaymentWithF4() {
  fireEvent.keyDown(window, { key: "F4" })
  return screen.findByRole("dialog", { name: "Pembayaran" })
}

/** Waits out the debounce the page leaves between a cart change and its price check. */
function waitPastPriceCheckDelay() {
  return act(() => new Promise((resolve) => setTimeout(resolve, 700)))
}

beforeEach(() => {
  livePrice = 3000
  saleCount = 0
  toastWarning.mockReset()
  toastError.mockReset()
  resetCartPriceRefresh()
  api = installApiMock({
    "GET /printers/settings": { printer_id: null, auto_print: false, paper_width: 58 },
    "GET /shifts/active": { id: 1 },
    "GET /products/popular": [],
    "GET /products": { data: [], total: 0, page: 1, per_page: 50, total_pages: 0 },
    "GET /products/lookup": () => lookup(),
    "GET /products/barcode/*": () => scannedProduct(),
    "GET /settings/sales": SETTINGS.sales,
    "GET /transactions/*/receipt/lines": [],
    "POST /transactions": () => checkoutResult(++saleCount),
  })
  useAuthStore.setState({
    user: {
      id: 1,
      username: "kasir1",
      full_name: "Kasir Satu",
      role: "kasir",
      is_active: true,
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00",
    },
    isResolved: true,
  })
  useShiftStore.setState({ activeShift: { id: 1 } as never })
  useCartStore.setState({
    items: [],
    heldCarts: [],
    itemDiscounts: {},
    transactionDiscount: null,
    checkoutKey: null,
    ownerId: 1,
  })
})

describe("scanner with focus away from the scan field", () => {
  it("adds the product when the scan's first digit arrives on a focused cart row", async () => {
    useCartStore.setState({ items: [cartItem({ cart_id: "product-2", product_id: 2 })] })
    renderPage()
    const row = screen.getByRole("row", { name: /Indomie Goreng/ })
    row.focus()

    fireEvent.keyDown(row, { key: "8" })
    expect(scanField()).toHaveFocus()
    scan(BARCODE)

    await waitFor(() =>
      expect(useCartStore.getState().items.map((item) => item.product_id)).toEqual([1, 2]),
    )
  })

  it("adds the same scanned product twice as one line with quantity 2", async () => {
    renderPage()

    scan(BARCODE)
    await waitFor(() => expect(useCartStore.getState().items).toHaveLength(1))
    scan(BARCODE)

    await waitFor(() => expect(useCartStore.getState().items[0].quantity).toBe(2))
    expect(useCartStore.getState().items).toHaveLength(1)
  })

  // The navbar sits outside the two panels. Without a shift, cancelling the
  // shift dialog opened from "Buka Kasir" hands focus back to that button; if
  // the next scan stayed there, its digits would go nowhere and its Enter
  // would open the shift dialog again.
  it("sends a scan to the scan field when focus is back on the navbar's Buka Kasir button", async () => {
    api.route("GET /shifts/active", null)
    useShiftStore.setState({ activeShift: null })
    renderPage()
    const autoDialog = await screen.findByRole("dialog")
    fireEvent.keyDown(autoDialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    const openShift = screen.getByRole("button", { name: "Buka Kasir" })
    openShift.focus()
    fireEvent.click(openShift)
    const dialog = await screen.findByRole("dialog")
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() => expect(openShift).toHaveFocus())

    fireEvent.keyDown(openShift, { key: "8" })

    expect(scanField()).toHaveFocus()
  })
})

describe("paying for the cart", () => {
  it("does nothing on F4 with an empty cart, also right after the last line was removed", async () => {
    useCartStore.setState({ items: [cartItem()] })
    renderPage()

    fireEvent.click(screen.getByRole("button", { name: "Hapus Indomie Goreng" }))
    expect(useCartStore.getState().items).toEqual([])
    fireEvent.keyDown(window, { key: "F4" })

    await waitPastPriceCheckDelay()
    expect(screen.queryByRole("dialog", { name: "Pembayaran" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bayar F4" })).toBeDisabled()
  })

  it("keeps payment shut on F4 while no shift is open", async () => {
    api.route("GET /shifts/active", null)
    useShiftStore.setState({ activeShift: null })
    useCartStore.setState({ items: [cartItem()] })
    renderPage()
    // The open-shift dialog asks first; the cashier waves it away.
    const shiftDialog = await screen.findByRole("dialog")
    fireEvent.keyDown(shiftDialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    fireEvent.keyDown(window, { key: "F4" })

    await waitPastPriceCheckDelay()
    expect(screen.queryByRole("dialog", { name: "Pembayaran" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bayar F4" })).toBeDisabled()
  })

  it("rings up a sale, empties the cart and starts the next sale on a fresh key", async () => {
    useCartStore.setState({ items: [cartItem()] })
    renderPage()
    await waitFor(() => expect(api.callsFor("GET /products/lookup")).toHaveLength(1))

    const dialog = await openPaymentWithF4()
    const cash = within(dialog).getByLabelText("Nominal Tunai")
    fireEvent.change(cash, { target: { value: "5000" } })
    expect(within(dialog).getByText("Kembalian")).toBeInTheDocument()
    expect(within(dialog).getByText(rupiah(2000))).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Bayar" }))

    const success = await screen.findByRole("dialog", { name: "Transaksi selesai" })
    expect(useCartStore.getState().items).toEqual([])
    const firstKey = api.lastCall("POST /transactions")?.headers.get("Idempotency-Key")
    expect(firstKey).toBeTruthy()

    fireEvent.keyDown(success, { key: "Escape" })
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Transaksi selesai" })).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(scanField()).toHaveFocus())

    // The next customer.
    scan(BARCODE)
    await waitFor(() => expect(useCartStore.getState().items).toHaveLength(1))
    const second = await openPaymentWithF4()
    fireEvent.change(within(second).getByLabelText("Nominal Tunai"), {
      target: { value: "5000" },
    })
    fireEvent.click(within(second).getByRole("button", { name: "Bayar" }))
    await screen.findByRole("dialog", { name: "Transaksi selesai" })

    const keys = api.callsFor("POST /transactions").map((call) => call.headers.get("Idempotency-Key"))
    expect(keys).toHaveLength(2)
    expect(keys[1]).not.toBe(keys[0])
  })

  it("keeps the cart and its key after a failed checkout, so the retry is the same sale", async () => {
    api.route("POST /transactions", apiFailure(503, "internal", "Server sibuk"))
    useCartStore.setState({ items: [cartItem()] })
    renderPage()

    const dialog = await openPaymentWithF4()
    fireEvent.change(within(dialog).getByLabelText("Nominal Tunai"), {
      target: { value: "5000" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Bayar" }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(screen.getByRole("dialog", { name: "Pembayaran" })).toBeInTheDocument()

    api.route("POST /transactions", () => checkoutResult(++saleCount))
    fireEvent.click(within(dialog).getByRole("button", { name: "Bayar" }))
    await screen.findByRole("dialog", { name: "Transaksi selesai" })

    const [first, retry] = api
      .callsFor("POST /transactions")
      .map((call) => call.headers.get("Idempotency-Key"))
    expect(retry).toBe(first)
  })

  it("books one sale for a double Enter in the cash field while the first is still out", async () => {
    let answer: (value: TransactionResult) => void = () => {}
    api.route(
      "POST /transactions",
      () =>
        new Promise<TransactionResult>((resolve) => {
          answer = resolve
        }),
    )
    useCartStore.setState({ items: [cartItem()] })
    renderPage()

    const dialog = await openPaymentWithF4()
    const cash = within(dialog).getByLabelText("Nominal Tunai")
    fireEvent.change(cash, { target: { value: "5000" } })
    fireEvent.keyDown(cash, { key: "Enter", timeStamp: 10_000 })
    await waitFor(() => expect(api.callsFor("POST /transactions")).toHaveLength(1))
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: /Bayar/ })).toBeDisabled(),
    )

    fireEvent.keyDown(cash, { key: "Enter", timeStamp: 10_200 })
    fireEvent.click(within(dialog).getByRole("button", { name: /Bayar/ }))

    act(() => answer(checkoutResult(1)))
    await screen.findByRole("dialog", { name: "Transaksi selesai" })
    expect(api.callsFor("POST /transactions")).toHaveLength(1)
  })
})

describe("payment and a stale price", () => {
  // No background re-price follows a re-scan: the page keys it on the cart's
  // product ids, which a quantity bump does not change. The re-scan itself
  // must carry the new price, or F4 opens on Rp 6.000 while the server books
  // Rp 7.000.
  it("opens payment on the current total after a re-scan picked up a new price", async () => {
    useCartStore.setState({ items: [cartItem()] })
    renderPage()
    await waitFor(() => expect(api.callsFor("GET /products/lookup")).toHaveLength(1))

    // The price goes up on the Produk page; then the same item is scanned again.
    livePrice = 3500
    scan(BARCODE)
    await waitFor(() => expect(useCartStore.getState().items[0].quantity).toBe(2))
    expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining("Indomie Goreng"))
    await waitPastPriceCheckDelay()

    const dialog = await openPaymentWithF4()
    expect(within(dialog).getByText(rupiah(7000))).toBeInTheDocument()
  })

  it("drops a pending price warning once the cart is emptied", async () => {
    livePrice = 3500
    useCartStore.setState({ items: [cartItem()] })
    renderPage()
    await waitFor(() => expect(useCartStore.getState().items[0].product_price).toBe(3500))

    act(() => useCartStore.getState().removeItem("product-1"))
    await waitPastPriceCheckDelay()
    act(() => useCartStore.getState().addItem({ ...scannedProduct(), id: 2, name: "Beras" }))
    await waitPastPriceCheckDelay()
    toastWarning.mockReset()

    await openPaymentWithF4()
    expect(toastWarning).not.toHaveBeenCalled()
  })

  // The "price changed, check the total" hold-back is for lines still in the
  // cart; a removed line's new price is no longer in the total.
  it("does not hold payment back for a repriced line that was removed", async () => {
    livePrice = 3500
    useCartStore.setState({
      items: [cartItem(), cartItem({ cart_id: "product-2", product_id: 2, product_name: "Beras" })],
    })
    renderPage()
    await waitFor(() => expect(useCartStore.getState().items[0].product_price).toBe(3500))

    fireEvent.click(screen.getByRole("button", { name: "Hapus Indomie Goreng" }))
    await waitPastPriceCheckDelay()
    toastWarning.mockReset()

    fireEvent.keyDown(window, { key: "F4" })
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))

    expect(toastWarning).not.toHaveBeenCalledWith(expect.stringContaining("Indomie Goreng"))
    expect(screen.getByRole("dialog", { name: "Pembayaran" })).toBeInTheDocument()
  })
})

describe("the PPOB below-cost guard", () => {
  const pulsa = cartItem({
    cart_id: "ppob-1",
    product_id: undefined,
    product_name: "Pulsa 10K",
    product_price: 12000,
    buy_price: 10500,
    quantity: 1,
    is_ppob: true,
  })

  it("lets a PPOB line through when the cart discount leaves it above cost", async () => {
    // 12.000 + 3.000 = 15.000; 1.000 off, of which the pulsa's share is 800.
    useCartStore.setState({
      items: [pulsa, cartItem()],
      transactionDiscount: { type: "fixed", value: 1000 },
    })
    renderPage()

    expect(await openPaymentWithF4()).toBeInTheDocument()
    expect(toastError).not.toHaveBeenCalled()
  })

  // The server gives the PPOB line its share of the cart discount and refuses
  // the sale when that drops it below cost (`reject_ppob_lines_below_cost`).
  // Payment must not open on a sale only Bayar would find out about.
  it("keeps payment shut when the cart discount pushes a PPOB line below cost", async () => {
    // A 12.000 pulsa costing 10.500 with 5.000 off the cart: sold for 7.000.
    useCartStore.setState({
      items: [pulsa],
      transactionDiscount: { type: "fixed", value: 5000 },
    })
    renderPage()

    fireEvent.keyDown(window, { key: "F4" })
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))

    expect(toastError).toHaveBeenCalledWith(
      "Harga Pulsa 10K setelah diskon di bawah harga modal. Kurangi diskonnya dulu.",
    )
    expect(screen.queryByRole("dialog", { name: "Pembayaran" })).not.toBeInTheDocument()
  })
})

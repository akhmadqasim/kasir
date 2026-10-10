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

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { SETTINGS } from "@/test-utils/settings-fixture"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { ProductLookup } from "@/features/products/types"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useCartStore } from "@/stores/cart-store"
import { resetCartPriceRefresh } from "./cart-price-refresh"
import { CashierPage } from "./components/cashier-page"
import type { CartItem } from "./types"
import { formatRupiah } from "./utils"

function cartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    cart_id: "product-1",
    product_id: 1,
    product_name: "Indomie Goreng",
    product_price: 3000,
    quantity: 2,
    stock: 50,
    unit: "pcs",
    ...overrides,
  }
}

function product(sellPrice: number): ProductLookup {
  return { id: 1, sell_price: sellPrice, stock: 50, unit: "pcs", is_active: true }
}

/** The catalogue's current price of product 1, as `GET /products/lookup` answers it. */
let livePrice = 3000
let api: ApiMock

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CashierPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function scanField() {
  return screen.getByRole("combobox", { name: "Scan barcode atau cari produk" })
}

beforeEach(() => {
  livePrice = 3000
  toastWarning.mockReset()
  toastError.mockReset()
  resetCartPriceRefresh()
  api = installApiMock({
    "GET /printers/settings": { printer_id: null, auto_print: false, paper_width: 58 },
    "GET /shifts/active": { id: 1 },
    "GET /products/popular": [],
    "GET /products/lookup": () => [product(livePrice)],
    "GET /settings/sales": SETTINGS.sales,
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
    items: [cartItem()],
    heldCarts: [],
    itemDiscounts: {},
    transactionDiscount: null,
    checkoutKey: null,
  })
})

describe("cashier page", () => {
  it("reprices a cart restored from a reload against the catalogue", async () => {
    livePrice = 3500
    renderPage()

    await waitFor(() => expect(useCartStore.getState().items[0].product_price).toBe(3500))
    expect(toastWarning).toHaveBeenCalledWith(
      `Harga Indomie Goreng berubah dari ${formatRupiah(3000)} menjadi ${formatRupiah(3500)}. Total keranjang sudah diperbarui.`,
    )
  })

  it("holds payment back once when a price changed since the line was added", async () => {
    renderPage()
    await waitFor(() => expect(api.callsFor("GET /products/lookup")).toHaveLength(1))

    // The catalogue moves; the next change to the cart's goods checks it.
    livePrice = 4000
    act(() => {
      useCartStore.setState({
        items: [
          ...useCartStore.getState().items,
          cartItem({ cart_id: "product-2", product_id: 2 }),
        ],
      })
    })
    await waitFor(() => expect(useCartStore.getState().items[0].product_price).toBe(4000), {
      timeout: 3000,
    })

    fireEvent.keyDown(window, { key: "F4" })

    await waitFor(() =>
      expect(toastWarning).toHaveBeenLastCalledWith(
        expect.stringContaining("Periksa total baru, lalu tekan Bayar lagi."),
      ),
    )
    expect(screen.queryByRole("dialog", { name: "Pembayaran" })).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: "F4" })

    expect(await screen.findByRole("dialog", { name: "Pembayaran" })).toBeInTheDocument()
  })

  it("opens payment at once when no price changed, without asking the catalogue", async () => {
    renderPage()
    await waitFor(() => expect(api.callsFor("GET /products/lookup")).toHaveLength(1))

    fireEvent.keyDown(window, { key: "F4" })

    expect(await screen.findByRole("dialog", { name: "Pembayaran" })).toBeInTheDocument()
    expect(api.callsFor("GET /products/lookup")).toHaveLength(1)
  })

  it("opens payment while a toast is showing", async () => {
    renderPage()
    await waitFor(() => expect(api.callsFor("GET /products/lookup")).toHaveLength(1))
    // What React Aria renders for a toast: a non-modal alertdialog.
    const fakeToast = document.createElement("div")
    fakeToast.setAttribute("role", "alertdialog")
    fakeToast.setAttribute("aria-modal", "false")
    document.body.append(fakeToast)

    fireEvent.keyDown(window, { key: "F4" })

    expect(await screen.findByRole("dialog", { name: "Pembayaran" })).toBeInTheDocument()
    fakeToast.remove()
  })

  it("still sends a stray key to the scan field while a toast is showing", () => {
    renderPage()
    const field = scanField()
    field.blur()
    const fakeToast = document.createElement("div")
    fakeToast.setAttribute("role", "alertdialog")
    fakeToast.setAttribute("aria-modal", "false")
    document.body.append(fakeToast)

    fireEvent.keyDown(document.body, { key: "8" })

    expect(field).toHaveFocus()
    fakeToast.remove()
  })

  it("keeps payment shut for a PPOB line discounted below cost", async () => {
    useCartStore.setState({
      items: [
        cartItem({
          cart_id: "ppob-1",
          product_id: undefined,
          product_name: "Pulsa 10K",
          product_price: 12000,
          buy_price: 10500,
          quantity: 1,
          is_ppob: true,
        }),
      ],
      itemDiscounts: { "ppob-1": { type: "fixed", value: 2000 } },
    })
    renderPage()

    fireEvent.keyDown(window, { key: "F4" })

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Harga Pulsa 10K setelah diskon di bawah harga modal. Kurangi diskonnya dulu.",
      ),
    )
    expect(screen.queryByRole("dialog", { name: "Pembayaran" })).not.toBeInTheDocument()
  })

  it("asks the catalogue for every cart line in one request", async () => {
    useCartStore.setState({
      items: [cartItem(), cartItem({ cart_id: "product-2", product_id: 2 })],
    })
    renderPage()

    await waitFor(() => expect(api.callsFor("GET /products/lookup")).toHaveLength(1))
    expect(api.lastCall("GET /products/lookup")?.query.get("ids")).toBe("1,2")
  })

  it("reprices the held carts once per app session, the active cart on every visit", async () => {
    useCartStore.setState({
      heldCarts: [
        {
          id: "held-1",
          label: "Bu Sri",
          items: [cartItem({ cart_id: "product-2", product_id: 2 })],
          itemDiscounts: {},
          transactionDiscount: null,
          heldAt: 0,
        },
      ],
    })
    const { unmount } = renderPage()
    await waitFor(() => expect(api.callsFor("GET /products/lookup")).toHaveLength(1))
    expect(api.lastCall("GET /products/lookup")?.query.get("ids")).toBe("1,2")
    unmount()

    renderPage()

    await waitFor(() => expect(api.callsFor("GET /products/lookup")).toHaveLength(2))
    expect(api.lastCall("GET /products/lookup")?.query.get("ids")).toBe("1")
  })

  it("lets an early F4 join the startup check instead of asking twice", async () => {
    renderPage()
    fireEvent.keyDown(window, { key: "F4" })

    expect(await screen.findByRole("dialog", { name: "Pembayaran" })).toBeInTheDocument()
    expect(api.callsFor("GET /products/lookup")).toHaveLength(1)
  })

  it("sends a scan typed after a cart dialog closed to the scan field", async () => {
    renderPage()
    const discountButton = screen.getByRole("button", { name: /Diskon/ })
    discountButton.focus()
    fireEvent.click(discountButton)
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Selesai" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    // Focus went back to the footer button that opened the dialog; the scan's
    // first digit takes it to the scan field before its Enter can press it.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "8" })

    expect(scanField()).toHaveFocus()
  })

  it("returns focus to the scan field when the cart panel asks for it", async () => {
    renderPage()
    scanField().blur()

    fireEvent.keyDown(window, { key: "F3" })
    const dialog = await screen.findByRole("dialog")
    fireEvent.submit(within(dialog).getByRole("textbox").closest("form") as HTMLFormElement)

    await waitFor(() => expect(useCartStore.getState().heldCarts).toHaveLength(1))
    await waitFor(() => expect(scanField()).toHaveFocus())
  })

  it("sends a key typed with focus on the page body to the scan field", async () => {
    renderPage()
    const field = scanField()
    field.blur()
    expect(document.body).toHaveFocus()

    fireEvent.keyDown(document.body, { key: "8" })

    expect(field).toHaveFocus()
  })

  it("sends a key typed with focus on a cart button to the scan field, past the table", async () => {
    renderPage()
    const trash = screen.getByRole("button", { name: "Hapus Indomie Goreng" })
    trash.focus()
    const tableKeyDown = vi.fn()
    trash.addEventListener("keydown", tableKeyDown)

    fireEvent.keyDown(trash, { key: "8" })

    expect(scanField()).toHaveFocus()
    // Stopped before the grid's typeahead could take the digit.
    expect(tableKeyDown).not.toHaveBeenCalled()
  })

  it.each([
    ["a Select's listbox option", "listbox", "option"],
    ["a Dropdown's menu item", "menu", "menuitem"],
  ])("leaves typeahead keys to %s", async (_, containerRole, itemRole) => {
    renderPage()
    const container = document.createElement("div")
    container.setAttribute("role", containerRole)
    const item = document.createElement("div")
    item.setAttribute("role", itemRole)
    item.tabIndex = -1
    container.append(item)
    document.body.append(container)
    item.focus()
    const typeahead = vi.fn()
    item.addEventListener("keydown", typeahead)

    fireEvent.keyDown(item, { key: "b" })

    expect(item).toHaveFocus()
    expect(typeahead).toHaveBeenCalled()
    container.remove()
  })

  it("leaves keys alone while focus is in an open non-modal popover", async () => {
    renderPage()
    const popover = document.createElement("div")
    popover.setAttribute("data-trigger", "ComboBox")
    const button = document.createElement("button")
    popover.append(button)
    document.body.append(popover)
    button.focus()

    fireEvent.keyDown(button, { key: "b" })

    expect(button).toHaveFocus()
    popover.remove()
  })

  it("leaves keys typed into another field alone", async () => {
    renderPage()
    const field = scanField()
    const other = document.createElement("input")
    document.body.append(other)
    other.focus()

    fireEvent.keyDown(other, { key: "8" })

    expect(other).toHaveFocus()
    expect(field).not.toHaveFocus()
    other.remove()
  })
})

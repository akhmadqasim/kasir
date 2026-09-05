import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

const invoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args),
}))

const toastError = vi.fn()

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: (message: string) => toastError(message),
    warning: vi.fn(),
  },
}))

import type { Product } from "@/features/products/types"
import { useCartStore } from "./hooks/use-cart-store"
import { ProductSearchPanel } from "./components/product-search-panel"

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    barcode: "8991234567890",
    sku: null,
    name: "Indomie Goreng",
    category_id: null,
    buy_price: 2500,
    sell_price: 3000,
    margin: 500,
    stock: 50,
    unit: "pcs",
    min_stock: 5,
    is_active: true,
    created_at: null,
    updated_at: null,
    ...overrides,
  } as Product
}

const CATALOGUE = [
  product(),
  product({ id: 2, name: "Beras Premium 5kg", barcode: "8990001112223", sell_price: 68000 }),
]

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProductSearchPanel />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function searchField() {
  return screen.getByRole("combobox", { name: "Scan barcode atau cari produk" })
}

/**
 * Jam palsu untuk pengenal scanner.
 *
 * `isLikelyBarcodeScannerInput` mengukur jarak antar-ketukan lewat `Date.now()`.
 * Dibiarkan mengikuti waktu nyata, satu worker yang sedang sibuk sudah cukup
 * membuat semburan scanner terbaca sebagai ketikan manusia, dan test-nya
 * berganti hasil dari run ke run.
 */
let nowMs = 1_000_000

/** Scanner mengetik payload-nya karakter demi karakter lalu menutup dengan Enter. */
function scan(field: HTMLElement, barcode: string) {
  for (let length = 1; length <= barcode.length; length++) {
    nowMs += 10
    fireEvent.change(field, { target: { value: barcode.slice(0, length) } })
  }
  nowMs += 20
  fireEvent.keyDown(field, { key: "Enter" })
}

function cartLines() {
  return useCartStore.getState().items
}

beforeEach(() => {
  nowMs = 1_000_000
  vi.spyOn(Date, "now").mockImplementation(() => nowMs)
  invoke.mockReset()
  invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === "get_popular_products") return Promise.resolve([])
    if (command === "search_products") {
      const params = (args?.params ?? {}) as { query?: string }
      const query = (params.query ?? "").toLowerCase()
      return Promise.resolve({
        data: CATALOGUE.filter(
          (item) =>
            item.name.toLowerCase().includes(query) ||
            (item.barcode ?? "").includes(query)
        ),
        total: CATALOGUE.length,
        page: 1,
        per_page: 50,
        total_pages: 1,
      })
    }
    if (command === "get_product_by_barcode") {
      const barcode = args?.barcode as string
      return Promise.resolve(CATALOGUE.find((item) => item.barcode === barcode) ?? null)
    }
    return Promise.resolve(null)
  })
  toastError.mockReset()
  useCartStore.setState({
    items: [],
    heldCarts: [],
    itemDiscounts: {},
    transactionDiscount: null,
    ppobCounter: 0,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("product search panel", () => {
  it("focuses the scan field on mount", () => {
    renderPanel()

    expect(searchField()).toHaveFocus()
  })

  it("adds the scanned product to the cart and clears the field", async () => {
    renderPanel()

    scan(searchField(), "8991234567890")

    await waitFor(() => expect(cartLines()).toHaveLength(1))
    expect(cartLines()[0].product_name).toBe("Indomie Goreng")
    expect(searchField()).toHaveValue("")
    expect(invoke).toHaveBeenCalledWith("get_product_by_barcode", {
      barcode: "8991234567890",
    })
  })

  it("adds the same product twice when it is scanned twice", async () => {
    renderPanel()

    scan(searchField(), "8991234567890")
    await waitFor(() => expect(cartLines()).toHaveLength(1))

    scan(searchField(), "8991234567890")

    // Baris keranjang tetap satu, kuantitasnya yang naik — dan itu hanya terjadi
    // kalau scan kedua benar-benar terkirim.
    await waitFor(() => expect(cartLines()[0].quantity).toBe(2))
  })

  it("reports a barcode that is not in the catalogue", async () => {
    renderPanel()

    scan(searchField(), "9999999999999")

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.lastCall![0]).toBe('Barcode "9999999999999" tidak ditemukan')
    expect(cartLines()).toHaveLength(0)
  })

  it("lists search results and marks the first one active", async () => {
    renderPanel()

    fireEvent.change(searchField(), { target: { value: "beras" } })

    const listbox = await screen.findByRole("listbox", { name: "Hasil pencarian produk" })
    const options = within(listbox).getAllByRole("option")
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveAttribute("aria-selected", "true")
    expect(searchField()).toHaveAttribute("aria-activedescendant", options[0].id)
  })

  it("adds the active result on Enter", async () => {
    renderPanel()

    fireEvent.change(searchField(), { target: { value: "indomie" } })
    await screen.findByRole("listbox", { name: "Hasil pencarian produk" })

    fireEvent.keyDown(searchField(), { key: "Enter" })

    await waitFor(() => expect(cartLines()).toHaveLength(1))
    expect(cartLines()[0].product_name).toBe("Indomie Goreng")
  })

  it("moves the active result with the arrow keys without losing focus", async () => {
    renderPanel()

    fireEvent.change(searchField(), { target: { value: "8" } })
    const listbox = await screen.findByRole("listbox", { name: "Hasil pencarian produk" })
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(2))

    // Peringkat barcode menaruh "Beras" di atas, jadi panah bawah menuju "Indomie".
    fireEvent.keyDown(searchField(), { key: "ArrowDown" })

    const options = within(listbox).getAllByRole("option")
    expect(options[0]).toHaveAttribute("aria-selected", "false")
    expect(options[1]).toHaveAttribute("aria-selected", "true")
    expect(searchField()).toHaveFocus()

    fireEvent.keyDown(searchField(), { key: "Enter" })

    await waitFor(() => expect(cartLines()).toHaveLength(1))
    expect(cartLines()[0].product_name).toBe("Indomie Goreng")
  })

  it("adds a result clicked with the mouse", async () => {
    renderPanel()

    fireEvent.change(searchField(), { target: { value: "beras" } })
    const listbox = await screen.findByRole("listbox", { name: "Hasil pencarian produk" })

    fireEvent.pointerDown(within(listbox).getAllByRole("option")[0])

    await waitFor(() => expect(cartLines()).toHaveLength(1))
    expect(cartLines()[0].product_name).toBe("Beras Premium 5kg")
  })

  it("returns focus to the scan field when the parent asks for it", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProductSearchPanel focusKey={0} />
        </MemoryRouter>
      </QueryClientProvider>
    )

    searchField().blur()
    expect(searchField()).not.toHaveFocus()

    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProductSearchPanel focusKey={1} />
        </MemoryRouter>
      </QueryClientProvider>
    )

    await waitFor(() => expect(searchField()).toHaveFocus())
  })
})

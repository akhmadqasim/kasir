import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

const toastError = vi.fn()

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: (message: string) => toastError(message),
    warning: vi.fn(),
  },
}))

import { installApiMock, type ApiCall, type ApiMock } from "@/test-utils/api-mock"
import type { PaginatedProducts, Product } from "@/features/products/types"
import { useCartStore } from "@/stores/cart-store"
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
    </QueryClientProvider>,
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

/** `GET /products/barcode/{barcode}` — the barcode is the last path segment. */
function scannedBarcode(call: ApiCall): string {
  return decodeURIComponent(call.path.split("/").pop() ?? "")
}

function searchResults(call: ApiCall): PaginatedProducts {
  const query = (call.query.get("query") ?? "").toLowerCase()
  return {
    data: CATALOGUE.filter(
      (item) => item.name.toLowerCase().includes(query) || (item.barcode ?? "").includes(query),
    ),
    total: CATALOGUE.length,
    page: 1,
    per_page: 50,
    total_pages: 1,
  }
}

let api: ApiMock

beforeEach(() => {
  nowMs = 1_000_000
  vi.spyOn(Date, "now").mockImplementation(() => nowMs)
  api = installApiMock({
    "GET /products/popular": [],
    "GET /products": searchResults,
    // The handler answers `null` for a barcode it does not know, rather than 404.
    "GET /products/barcode/*": (call) =>
      CATALOGUE.find((item) => item.barcode === scannedBarcode(call)) ?? null,
    // Fired for every line added from the search list, to teach the shortcut
    // grid what sells. Nothing on this screen waits for its answer.
    "POST /products/*/select": null,
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
    expect(api.lastCall("GET /products/barcode/*")?.path).toBe("/products/barcode/8991234567890")
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
      </QueryClientProvider>,
    )

    searchField().blur()
    expect(searchField()).not.toHaveFocus()

    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProductSearchPanel focusKey={1} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(searchField()).toHaveFocus())
  })

  /**
   * Ubin Favorit. Yang dijaga di sini bukan rupanya melainkan bentuknya: pin
   * adalah tombol tersendiri di sebelah ubin, bukan `span role="button"` di
   * dalamnya — tombol di dalam tombol tidak bisa dicapai papan ketik dan bukan
   * HTML yang sah.
   */
  describe("shortcut tiles", () => {
    const SHORTCUTS = [
      { ...product({ id: 7, name: "Yakult Merah, Mangga, Strawberry 5 pcs" }), is_pinned: true },
      { ...product({ id: 8, name: "Teh Botol", sell_price: 500 }), is_pinned: false },
    ]

    beforeEach(() => {
      api.route("GET /products/popular", SHORTCUTS)
      api.route("POST /products/*/pin", true)
    })

    it("shows each shortcut's name and its price", async () => {
      renderPanel()

      expect(await screen.findByText("Teh Botol")).toBeInTheDocument()
      expect(screen.getByText("Rp 500")).toBeInTheDocument()
      expect(screen.getByText("Yakult Merah, Mangga, Strawberry 5 pcs")).toBeInTheDocument()
      expect(screen.getByText("Rp 3.000")).toBeInTheDocument()
    })

    it("adds the product to the cart when the tile is pressed", async () => {
      renderPanel()

      // Nama ubinnya adalah isinya, nama pin-nya "Pin <produk>" — jangkarkan
      // polanya di awal supaya keduanya tidak sama-sama cocok.
      fireEvent.click(await screen.findByRole("button", { name: /^Teh Botol/ }))

      await waitFor(() => expect(cartLines()).toHaveLength(1))
      expect(cartLines()[0].product_id).toBe(8)
    })

    it("keeps the pin control a real button beside the tile, not nested inside it", async () => {
      renderPanel()

      const pin = await screen.findByRole("button", { name: "Pin Teh Botol" })
      expect(pin.tagName).toBe("BUTTON")
      // `closest` mulai dari elemennya sendiri, jadi yang membuktikan tidak ada
      // tombol di dalam tombol adalah pencarian dari induknya ke atas.
      expect(pin.parentElement?.closest("button")).toBeNull()
    })

    it("pins a product from its tile without adding it to the cart", async () => {
      renderPanel()

      fireEvent.click(await screen.findByRole("button", { name: "Pin Teh Botol" }))

      await waitFor(() => expect(api.callsFor("POST /products/8/pin")).toHaveLength(1))
      expect(cartLines()).toHaveLength(0)
    })

    /**
     * Melepas pin lewat papan ketik. Menahan tidak bisa dilakukan dengan Tab,
     * jadi Enter melepasnya langsung — tanpa ini tombolnya perhentian Tab yang
     * tidak melakukan apa-apa.
     */
    it("unpins a pinned product from the keyboard", async () => {
      renderPanel()

      const unpin = await screen.findByRole("button", {
        name: "Tahan untuk hapus pin Yakult Merah, Mangga, Strawberry 5 pcs",
      })
      fireEvent.keyDown(unpin, { key: "Enter" })
      fireEvent.keyUp(unpin, { key: "Enter" })

      await waitFor(() => expect(api.callsFor("POST /products/7/pin")).toHaveLength(1))
    })

    /**
     * Menahan pin selama `HOLD_DURATION` melepasnya. Ini yang membuktikan
     * handler pointer-nya selamat dari `filterDOMProps` HeroUI — `Button`
     * membuang `onClick`, jadi kalau pointer-nya ikut tersaring, fitur ini mati
     * tanpa satu pun test lain gagal.
     */
    it("unpins a pinned product after the pin is held", async () => {
      renderPanel()

      const unpin = await screen.findByRole("button", {
        name: "Tahan untuk hapus pin Yakult Merah, Mangga, Strawberry 5 pcs",
      })
      fireEvent.pointerDown(unpin)
      // Jam-nya beku (`Date.now` di-mock), jadi tahanannya dimajukan dengan
      // memajukan jam itu: tik interval berikutnya membaca 600ms sudah lewat.
      nowMs += 600

      await waitFor(() => expect(api.callsFor("POST /products/7/pin")).toHaveLength(1))
    })

    it("offers a hold-to-unpin control for a pinned product", async () => {
      renderPanel()

      const unpin = await screen.findByRole("button", {
        name: "Tahan untuk hapus pin Yakult Merah, Mangga, Strawberry 5 pcs",
      })
      expect(unpin.tagName).toBe("BUTTON")
    })
  })
})

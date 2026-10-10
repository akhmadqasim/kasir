import { createRef } from "react"
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

import { apiFailure, installApiMock, type ApiCall, type ApiMock } from "@/test-utils/api-mock"
import type { PaginatedProducts, Product } from "@/features/products/types"
import { useCartStore } from "@/stores/cart-store"
import { refreshCartPrices, resetCartPriceRefresh } from "./cart-price-refresh"
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
  resetCartPriceRefresh()
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

  it("keeps the digits of the next scan typed while the lookup is still answering", async () => {
    let release: () => void = () => {}
    api.route(
      "GET /products/barcode/*",
      () => new Promise((resolve) => (release = () => resolve(CATALOGUE[0]))),
    )
    renderPanel()
    const field = searchField()

    scan(field, "8991234567890")
    await waitFor(() => expect(api.callsFor("GET /products/barcode/*")).toHaveLength(1))
    // The field empties as soon as the lookup leaves, so the next scan starts
    // clean instead of on the tail of this one.
    expect(field).toHaveValue("")
    nowMs += 300
    fireEvent.change(field, { target: { value: "8" } })
    nowMs += 10
    fireEvent.change(field, { target: { value: "89" } })
    release()

    await waitFor(() => expect(cartLines()).toHaveLength(1))
    expect(field).toHaveValue("89")
  })

  it("looks up a second scan finished while the first lookup is pending on its own", async () => {
    const pending: Array<() => void> = []
    api.route(
      "GET /products/barcode/*",
      (call) =>
        new Promise((resolve) =>
          pending.push(() =>
            resolve(CATALOGUE.find((item) => item.barcode === scannedBarcode(call)) ?? null),
          ),
        ),
    )
    renderPanel()
    const field = searchField()

    scan(field, "8991234567890")
    nowMs += 300
    scan(field, "8990001112223")
    await waitFor(() => expect(api.callsFor("GET /products/barcode/*")).toHaveLength(2))
    pending.forEach((resolve) => resolve())

    await waitFor(() => expect(cartLines()).toHaveLength(2))
    expect(api.callsFor("GET /products/barcode/*").map(scannedBarcode)).toEqual([
      "8991234567890",
      "8990001112223",
    ])
    expect(toastError).not.toHaveBeenCalled()
  })

  it("lets a scan replace text left in the field instead of appending to it", async () => {
    renderPanel()
    const field = searchField()

    fireEvent.change(field, { target: { value: "ind" } })
    nowMs += 1000
    scan(field, "8990001112223")

    await waitFor(() => expect(cartLines()).toHaveLength(1))
    expect(cartLines()[0].product_name).toBe("Beras Premium 5kg")
    expect(api.lastCall("GET /products/barcode/*")?.path).toBe("/products/barcode/8990001112223")
  })

  it("keeps text typed by hand, even typed quickly in short runs", () => {
    renderPanel()
    const field = searchField()

    fireEvent.change(field, { target: { value: "ind" } })
    nowMs += 200
    // Four quick keys — a fast hand, not a scanner burst.
    for (const value of ["indo", "indom", "indomi", "indomie"]) {
      nowMs += 20
      fireEvent.change(field, { target: { value } })
    }

    expect(field).toHaveValue("indomie")
  })

  it("keeps text typed by hand, even a long run typed as fast as a scanner", () => {
    renderPanel()
    const field = searchField()

    fireEvent.change(field, { target: { value: "ind" } })
    nowMs += 200
    // Eleven letters at scanner speed: still a hand, because a scan is digits.
    const rest = "omie goreng"
    for (let length = 1; length <= rest.length; length++) {
      nowMs += 10
      fireEvent.change(field, { target: { value: `ind${rest.slice(0, length)}` } })
    }

    expect(field).toHaveValue("indomie goreng")
  })

  it("reports a barcode that is not in the catalogue", async () => {
    renderPanel()

    scan(searchField(), "9999999999999")

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.lastCall![0]).toBe('Barcode "9999999999999" tidak ditemukan')
    expect(cartLines()).toHaveLength(0)
  })

  // Sebelumnya, 6 digit yang diketik cepat lalu Enter jatuh ke lookup barcode
  // persis, meleset, dan langsung menoast "tidak ditemukan" sambil mengosongkan
  // kolom — pencarian suffix-nya tidak pernah sempat jalan.
  it("falls back to the search when a partial barcode misses the exact lookup", async () => {
    renderPanel()

    scan(searchField(), "567890")

    const listbox = await screen.findByRole("listbox", { name: "Hasil pencarian produk" })
    expect(within(listbox).getAllByRole("option")).toHaveLength(1)
    expect(toastError).not.toHaveBeenCalled()
    expect(searchField()).toHaveValue("567890")
  })

  // Setiap panjang barcode sungguhan tetap harus dilaporkan hilang dan
  // mengosongkan kolom — kalau tidak, scan berikutnya menempel di ekor scan ini.
  it.each([
    ["EAN-8", "99999999"],
    ["UPC-A", "999999999999"],
    ["EAN-13", "9999999999999"],
    ["ITF-14", "99999999999999"],
  ])("still reports a whole %s that misses as not found", async (_label, barcode) => {
    renderPanel()

    scan(searchField(), barcode)

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.lastCall![0]).toBe(`Barcode "${barcode}" tidak ditemukan`)
    expect(searchField()).toHaveValue("")
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

  it("does not claim 'not found' while the search is still answering", async () => {
    let release: () => void = () => {}
    api.route(
      "GET /products",
      (call) => new Promise((resolve) => (release = () => resolve(searchResults(call)))),
    )
    renderPanel()

    fireEvent.change(searchField(), { target: { value: "beras" } })
    await waitFor(() => expect(api.callsFor("GET /products")).toHaveLength(1))

    expect(screen.queryByText("Produk tidak ditemukan")).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Mencari…")

    release()
    expect(await screen.findByRole("option", { name: /Beras Premium/ })).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("1 produk ditemukan")
  })

  it("says so, with a retry, when the search request fails", async () => {
    api.route("GET /products", apiFailure(500, "internal", "Server sedang sibuk"))
    renderPanel()

    fireEvent.change(searchField(), { target: { value: "beras" } })

    expect(await screen.findByText("Gagal mencari produk")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeInTheDocument()
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

  /**
   * Search results and tiles may come from the query cache, up to its stale
   * time old. Only a fresh barcode lookup may let the check after a cart
   * change skip the line.
   */
  describe("the price check after a cart change", () => {
    beforeEach(() => {
      api.route("GET /products/lookup", (call: ApiCall) =>
        (call.query.get("ids") ?? "").split(",").map((productId) => ({
          id: Number(productId),
          sell_price: 3000,
          stock: 50,
          unit: "pcs",
          is_active: true,
        })),
      )
    })

    it("still checks a line added from the search list", async () => {
      renderPanel()
      fireEvent.change(searchField(), { target: { value: "indomie" } })
      await screen.findByRole("listbox", { name: "Hasil pencarian produk" })
      fireEvent.keyDown(searchField(), { key: "Enter" })
      await waitFor(() => expect(cartLines()).toHaveLength(1))

      await refreshCartPrices({ skipLookupPriced: true })

      expect(api.callsFor("GET /products/lookup")).toHaveLength(1)
    })

    it("skips a line a barcode lookup has just priced", async () => {
      renderPanel()
      scan(searchField(), "8991234567890")
      await waitFor(() => expect(cartLines()).toHaveLength(1))

      await refreshCartPrices({ skipLookupPriced: true })

      expect(api.callsFor("GET /products/lookup")).toHaveLength(0)
    })
  })

  it("uses the parent's ref for the scan field", () => {
    const inputRef = createRef<HTMLInputElement>()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProductSearchPanel inputRef={inputRef} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(inputRef.current).toBe(searchField())
  })

  /**
   * Ubin Favorit: satu tombol per produk, tanpa kontrol pin — pin diatur dari
   * halaman Produk.
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

    it("has no pin control on the tile — pinning lives on the Produk page", async () => {
      renderPanel()
      await screen.findByRole("button", { name: /Teh Botol/ })

      expect(screen.queryByRole("button", { name: /Pin Teh Botol/ })).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /hapus pin/ })).not.toBeInTheDocument()
    })
  })
})

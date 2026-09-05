import { beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { act, render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { PaginatedProducts, Product } from "@/features/products/types"

const invoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args),
}))

import { ProductAutocomplete } from "./product-autocomplete"

function product(id: number, name: string): Product {
  return {
    id,
    barcode: null,
    sku: null,
    name,
    category_id: null,
    buy_price: 1000 * id,
    sell_price: 1500 * id,
    margin: 0,
    stock: 10 * id,
    unit: "pcs",
    min_stock: 0,
    is_active: true,
    created_at: "2026-09-05 00:00:00",
    updated_at: "2026-09-05 00:00:00",
  }
}

const RESULTS: PaginatedProducts = {
  data: [product(1, "Beras Pandan Wangi"), product(2, "Beras Rojolele")],
  total: 2,
  page: 1,
  per_page: 10,
  total_pages: 1,
}

function Harness({ onSelect }: { onSelect?: (product: Product | null) => void }) {
  const [selected, setSelected] = useState<Product | null>(null)
  return (
    <ProductAutocomplete
      label="Produk"
      placeholder="Pilih produk"
      searchPlaceholder="Cari nama produk atau barcode..."
      value={selected}
      onSelect={(picked) => {
        setSelected(picked)
        onSelect?.(picked)
      }}
      renderDetail={(item) => `Stok: ${item.stock} ${item.unit}`}
    />
  )
}

function renderHarness(onSelect?: (product: Product | null) => void) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Harness onSelect={onSelect} />
    </QueryClientProvider>
  )
}

/** Pemicu `Autocomplete`: namanya adalah nilai terpilih diikuti label kolomnya. */
function trigger() {
  return screen.getByRole("button", { name: /Produk$/ })
}

/** Membuka popover lalu mengetik kueri pencarian. */
async function search(query: string) {
  fireEvent.click(trigger())
  const input = await screen.findByRole("searchbox")
  fireEvent.change(input, { target: { value: query } })
  return input
}

/** Melewati jendela debounce tanpa memicu peringatan `act`. */
async function settleDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400))
  })
}

function searchCallCount() {
  return invoke.mock.calls.filter(([command]) => command === "search_products").length
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockImplementation((command: string) => {
    if (command === "search_products") return Promise.resolve(RESULTS)
    return Promise.resolve(null)
  })
})

/**
 * Pencarian produk dulu dirakit tangan di dua layar: `Input` biasa, `div` absolut
 * berisi tombol hasil, dan penanganan klik-di-luar. Yang harus tetap jalan setelah
 * pindah ke `Autocomplete` cuma tiga: hasilnya muncul, memilih mengembalikan produk
 * yang benar, dan pilihan bisa dibatalkan.
 */
describe("pencarian produk", () => {
  it("baru memanggil backend setelah kueri cukup panjang", async () => {
    renderHarness()

    const input = await search("b")
    await settleDebounce()
    expect(searchCallCount()).toBe(0)

    fireEvent.change(input, { target: { value: "beras" } })
    expect(await screen.findByRole("option", { name: /Beras Pandan Wangi/ })).toBeInTheDocument()
    expect(searchCallCount()).toBeGreaterThan(0)
  })

  it("mengembalikan produk yang dipilih dan menampilkannya di pemicu", async () => {
    const onSelect = vi.fn()
    renderHarness(onSelect)

    await search("beras")
    fireEvent.click(await screen.findByRole("option", { name: /Beras Rojolele/ }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 2, name: "Beras Rojolele" })
    expect(trigger()).toHaveAccessibleName(/Beras Rojolele/)
  })

  it("mengosongkan pilihan lewat tombol hapus", async () => {
    const onSelect = vi.fn()
    renderHarness(onSelect)

    await search("beras")
    fireEvent.click(await screen.findByRole("option", { name: /Beras Rojolele/ }))
    expect(trigger()).toHaveAccessibleName(/Beras Rojolele/)

    fireEvent.click(screen.getByLabelText("Clear selection"))

    expect(onSelect).toHaveBeenLastCalledWith(null)
    expect(trigger()).toHaveAccessibleName(/Pilih produk/)
  })
})

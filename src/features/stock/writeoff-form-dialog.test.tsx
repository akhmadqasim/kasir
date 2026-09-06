import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import type { PaginatedProducts, Product } from "@/features/products/types"

import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { WriteoffFormDialog } from "./components/writeoff-form-dialog"

function product(id: number, name: string, stock: number, buyPrice: number): Product {
  return {
    id,
    barcode: null,
    sku: null,
    name,
    category_id: null,
    buy_price: buyPrice,
    sell_price: buyPrice * 1.3,
    margin: 0,
    stock,
    unit: "pcs",
    min_stock: 0,
    is_active: true,
    created_at: "2026-09-05 00:00:00",
    updated_at: "2026-09-05 00:00:00",
  }
}

const SEARCH_RESULTS: PaginatedProducts = {
  data: [product(5, "Telur Ayam 1kg", 12, 25000)],
  total: 1,
  page: 1,
  per_page: 10,
  total_pages: 1,
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <WriteoffFormDialog open onOpenChange={() => {}} />
    </QueryClientProvider>
  )
}

function productTrigger() {
  return screen.getByRole("button", { name: /Produk \*$/ })
}

async function pickProduct() {
  fireEvent.click(productTrigger())
  const input = await screen.findByRole("searchbox")
  fireEvent.change(input, { target: { value: "telur" } })
  fireEvent.click(await screen.findByRole("option", { name: /Telur Ayam 1kg/ }))
}

function setQuantity(value: string) {
  const input = screen.getByRole("textbox", { name: /Jumlah/ })
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

let api: ApiMock

beforeEach(() => {
  api = installApiMock({
    "GET /products": SEARCH_RESULTS,
    "POST /stock/writeoffs": {
      ...SEARCH_RESULTS.data[0],
      status: "approved",
      refundId: null,
    },
  })
  useAuthStore.setState({
    user: {
      id: 1,
      username: "admin",
      full_name: "Admin",
      role: "admin",
      is_active: true,
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00",
    },
  })
})

/**
 * Formulir write-off memilih produk lewat `Autocomplete` sekarang, bukan dropdown
 * rakitan tangan. Yang dijaga: produk yang dipilih benar-benar terpasang, batas
 * stoknya ikut terbawa ke validasi, dan pilihan bisa dibatalkan.
 */
describe("formulir write-off", () => {
  it("memasang produk yang dipilih beserta stok dan harga modalnya", async () => {
    renderDialog()
    await pickProduct()

    expect(productTrigger()).toHaveAccessibleName(/Telur Ayam 1kg/)
    expect(screen.getByText(/Stok: 12 pcs/)).toBeInTheDocument()
  })

  it("menghitung estimasi kerugian dari harga modal", async () => {
    renderDialog()
    await pickProduct()
    setQuantity("3")

    expect(screen.getByText("Estimasi Kerugian")).toBeInTheDocument()
    expect(screen.getByText("Rp 75.000")).toBeInTheDocument()
  })

  // `NumberField` menjepit nilainya ke `maxValue` saat kolom ditinggalkan, jadi
  // jumlah di atas stok tidak pernah sampai ke tombol kirim. `Input type=number`
  // yang lama membiarkannya lolos dan baru ditolak saat submit.
  it("menjepit jumlah ke stok yang tersedia", async () => {
    renderDialog()
    await pickProduct()
    setQuantity("99")

    expect(screen.getByRole("textbox", { name: /Jumlah/ })).toHaveValue("12")
    expect(screen.getByText("Rp 300.000")).toBeInTheDocument()
  })

  it("mengirim write-off setelah produk, jumlah dan alasan terisi", async () => {
    renderDialog()
    await pickProduct()
    setQuantity("2")

    fireEvent.click(screen.getByRole("button", { name: /Alasan \*$/ }))
    fireEvent.click(await screen.findByRole("option", { name: /Rusak/ }))

    fireEvent.click(screen.getByRole("button", { name: "Buat Write-off" }))

    await vi.waitFor(() => {
      // Endpoint stok memakai camelCase, mengikuti struct Rust-nya. Pencatatnya
      // diambil dari sesi, jadi tidak ada lagi id pemanggil di badan permintaan.
      expect(api.lastCall("POST /stock/writeoffs")?.body).toEqual({
        productId: 5,
        quantity: 2,
        reason: "damaged",
      })
    })
  })

  it("menahan pengiriman sampai alasannya dipilih", async () => {
    renderDialog()
    await pickProduct()
    setQuantity("2")

    fireEvent.click(screen.getByRole("button", { name: "Buat Write-off" }))

    expect(await screen.findByText("Pilih alasan write-off")).toBeInTheDocument()
    expect(api.callsFor("POST /stock/writeoffs")).toHaveLength(0)
  })

  it("mengosongkan produk lewat tombol hapus", async () => {
    renderDialog()
    await pickProduct()

    fireEvent.click(screen.getByLabelText("Clear selection"))

    expect(productTrigger()).toHaveAccessibleName(/Pilih produk/)
    expect(screen.queryByText(/Stok: 12 pcs/)).not.toBeInTheDocument()
  })
})

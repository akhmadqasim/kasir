import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import type { User } from "@/features/auth/types"
import type { Category, PaginatedProducts, Product } from "./types"

import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { ProductsPage } from "./components/products-page"

const ADMIN: User = {
  id: 1,
  username: "admin",
  full_name: "Admin Toko",
  role: "admin",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

const CATEGORIES: Category[] = [
  { id: 7, name: "Mie Instan", description: null, created_at: "2026-01-01 00:00:00" },
  { id: 9, name: "Bahan Pokok", description: null, created_at: "2026-01-01 00:00:00" },
]

function product(id: number, name: string, categoryId: number | null): Product {
  return {
    id,
    barcode: null,
    sku: null,
    name,
    category_id: categoryId,
    buy_price: 2500,
    sell_price: 3000,
    margin: 20,
    stock: 12,
    unit: "pcs",
    min_stock: 3,
    is_active: true,
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
  }
}

const PRODUCTS: PaginatedProducts = {
  data: [product(1, "Indomie Goreng", 7), product(2, "Gula Pasir 1kg", null)],
  total: 2,
  page: 1,
  per_page: 50,
  total_pages: 1,
}

/**
 * Aksi halaman (Import, Kelola Kategori, Tambah Produk) di-portal ke slot navbar
 * lewat `NavbarActions`, jadi tanpa `TestNavbar` tombolnya tidak pernah tergambar.
 */
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TestNavbar>
        <ProductsPage />
      </TestNavbar>
    </QueryClientProvider>,
  )
}

/** Membuka dialog tambah produk dan mengisi kolom yang wajib lolos validasi. */
async function openFilledForm() {
  renderPage()
  await screen.findByText("Indomie Goreng")

  fireEvent.click(screen.getByRole("button", { name: "Tambah Produk" }))
  const dialog = within(await screen.findByRole("dialog"))

  fireEvent.change(dialog.getByLabelText("Nama Produk *"), { target: { value: "Kopi Sachet" } })
  fireEvent.change(dialog.getByLabelText("Stok *"), { target: { value: "10" } })
  fireEvent.change(dialog.getByLabelText("Harga Modal *"), { target: { value: "1000" } })
  fireEvent.change(dialog.getByLabelText("Harga Jual *"), { target: { value: "1500" } })

  return dialog
}

/** Kolom ketik `ComboBox` — namanya diambil dari `<Label>Kategori</Label>`. */
function categoryInput() {
  return screen.getByRole("combobox", { name: "Kategori" })
}

/**
 * Membuka popover lewat tombol panahnya. Nama tombolnya dirakit React Aria dari
 * teksnya sendiri plus label kolom, jadi yang dicocokkan cuma ekornya.
 */
function openCategoryList() {
  fireEvent.click(screen.getByRole("button", { name: /Kategori$/ }))
}

let api: ApiMock

function createdProductInput() {
  return api.lastCall("POST /products")?.body as Record<string, unknown> | undefined
}

beforeEach(() => {
  api = installApiMock({
    "GET /products": PRODUCTS,
    "GET /products/popular": [],
    "GET /categories": CATEGORIES,
    "POST /products": PRODUCTS.data[0],
    "DELETE /products/*": null,
    "POST /categories": CATEGORIES[0],
    "PUT /categories/*": CATEGORIES[0],
    "DELETE /categories/*": null,
    "POST /products/bulk": { imported: 1, updated: 0, skipped: 0, errors: [] },
  })
  useAuthStore.setState({ user: ADMIN })
})

/**
 * Pemilih kategori pindah dari combobox Base UI ke `ComboBox` HeroUI, dan tombol
 * silangnya diganti baris "Tanpa kategori". Yang dijaga di sini: mengetik tetap
 * menyaring daftar, kategori terpilih tetap sampai ke `create_product`, dan
 * kategori masih bisa dikosongkan — sekarang lewat keyboard, bukan cuma mouse.
 */
describe("halaman produk", () => {
  it("menyaring daftar kategori sesuai ketikan", async () => {
    await openFilledForm()

    openCategoryList()
    expect(await screen.findByRole("option", { name: "Bahan Pokok" })).toBeInTheDocument()

    fireEvent.change(categoryInput(), { target: { value: "Mie" } })

    expect(await screen.findByRole("option", { name: "Mie Instan" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Bahan Pokok" })).not.toBeInTheDocument()
  })

  it("mengirim kategori yang dipilih ke backend", async () => {
    const dialog = await openFilledForm()

    openCategoryList()
    fireEvent.click(await screen.findByRole("option", { name: "Bahan Pokok" }))
    expect(categoryInput()).toHaveValue("Bahan Pokok")

    fireEvent.click(dialog.getByRole("button", { name: "Simpan" }))

    await vi.waitFor(() => expect(createdProductInput()).toBeDefined())
    expect(createdProductInput()).toMatchObject({ name: "Kopi Sachet", category_id: 9 })
  })

  it("mengosongkan kategori lewat baris 'Tanpa kategori'", async () => {
    const dialog = await openFilledForm()

    openCategoryList()
    fireEvent.click(await screen.findByRole("option", { name: "Mie Instan" }))
    expect(categoryInput()).toHaveValue("Mie Instan")

    openCategoryList()
    fireEvent.click(await screen.findByRole("option", { name: "Tanpa kategori" }))
    expect(categoryInput()).toHaveValue("Tanpa kategori")

    fireEvent.click(dialog.getByRole("button", { name: "Simpan" }))

    await vi.waitFor(() => expect(createdProductInput()).toBeDefined())
    expect(createdProductInput()).toMatchObject({ category_id: null })
  })

  it("meminta konfirmasi sebelum menghapus produk", async () => {
    renderPage()

    await screen.findByText("Indomie Goreng")
    fireEvent.click(screen.getByRole("button", { name: "Hapus Indomie Goreng" }))

    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText("Yakin ingin menghapus produk ini?")).toBeInTheDocument()
    expect(api.callsFor("DELETE /products/*")).toHaveLength(0)

    fireEvent.click(within(confirm).getByRole("button", { name: "Hapus" }))

    await vi.waitFor(() => {
      expect(api.lastCall("DELETE /products/*")?.path).toBe("/products/1")
    })
  })

  /**
   * The full invalidation path, end to end: a save has to make the list refetch.
   *
   * This is the one that used to break silently. The list is cached under
   * `["products","search",params]` and the create mutation invalidates
   * `["products"]`; if either side drifts, nothing errors — the table simply
   * keeps showing what it showed before the save.
   */
  it("memuat ulang daftar produk setelah produk baru disimpan", async () => {
    const dialog = await openFilledForm()
    const listCallsBefore = api.callsFor("GET /products").length

    fireEvent.click(dialog.getByRole("button", { name: "Simpan" }))

    await vi.waitFor(() => expect(createdProductInput()).toBeDefined())
    await vi.waitFor(() => {
      expect(api.callsFor("GET /products").length).toBeGreaterThan(listCallsBefore)
    })
  })

  /**
   * Pengurutan mengikuti contoh "Sorting" di dokumentasi Table HeroUI: kolom
   * `allowsSorting` mengirim `SortDescriptor`, dan halaman meneruskannya ke
   * server sebagai `sort_by` / `sort_order` — daftarnya dipaginasi di server,
   * jadi mengurutkan di sisi klien hanya akan mengurutkan satu halaman.
   */
  describe("pengurutan", () => {
    function lastSort() {
      const query = api.lastCall("GET /products")?.query
      return { by: query?.get("sort_by"), order: query?.get("sort_order") }
    }

    async function renderSorted() {
      renderPage()
      await screen.findByText("Indomie Goreng")
      return within(screen.getByRole("grid", { name: "Produk" }))
    }

    it("memuat daftar dengan urutan bawaan: yang terbaru dulu, tanpa panah", async () => {
      const grid = await renderSorted()

      expect(lastSort()).toEqual({ by: "created_at", order: "desc" })
      for (const header of grid.getAllByRole("columnheader")) {
        expect(header).not.toHaveAttribute("aria-sort", "ascending")
        expect(header).not.toHaveAttribute("aria-sort", "descending")
      }
    })

    it("klik kepala kolom mengurutkan naik, klik lagi membalik", async () => {
      const grid = await renderSorted()
      const name = grid.getByRole("columnheader", { name: /Nama Produk/ })

      fireEvent.click(name)
      await vi.waitFor(() => expect(lastSort()).toEqual({ by: "name", order: "asc" }))
      expect(name).toHaveAttribute("aria-sort", "ascending")

      fireEvent.click(name)
      await vi.waitFor(() => expect(lastSort()).toEqual({ by: "name", order: "desc" }))
      expect(name).toHaveAttribute("aria-sort", "descending")
    })

    it("pindah kolom mulai lagi dari naik, dan hanya satu kolom yang berpanah", async () => {
      const grid = await renderSorted()

      fireEvent.click(grid.getByRole("columnheader", { name: /Harga Jual/ }))
      await vi.waitFor(() => expect(lastSort()).toEqual({ by: "sell_price", order: "asc" }))
      fireEvent.click(grid.getByRole("columnheader", { name: /Harga Jual/ }))
      await vi.waitFor(() => expect(lastSort()).toEqual({ by: "sell_price", order: "desc" }))

      fireEvent.click(grid.getByRole("columnheader", { name: /Kategori/ }))
      await vi.waitFor(() => expect(lastSort()).toEqual({ by: "category", order: "asc" }))

      expect(grid.getByRole("columnheader", { name: /Kategori/ })).toHaveAttribute(
        "aria-sort",
        "ascending",
      )
      expect(grid.getByRole("columnheader", { name: /Harga Jual/ })).not.toHaveAttribute(
        "aria-sort",
        "descending",
      )
      expect(grid.getByRole("columnheader", { name: id.products.action })).not.toHaveAttribute(
        "aria-sort",
      )
    })

    it("filter stok menipis mengurutkan dari yang paling sedikit sampai dipilih kolom lain", async () => {
      const grid = await renderSorted()

      // Urutan yang dipilih tangan tidak bertahan melewati pergantian filter:
      // "Stok Rendah" selalu mulai dari yang paling menipis.
      fireEvent.click(grid.getByRole("columnheader", { name: /Nama Produk/ }))
      await vi.waitFor(() => expect(lastSort()).toEqual({ by: "name", order: "asc" }))

      fireEvent.click(screen.getByRole("button", { name: "Stok Rendah" }))
      await vi.waitFor(() => expect(lastSort()).toEqual({ by: "stock", order: "asc" }))
      expect(grid.getByRole("columnheader", { name: /^Stok/ })).toHaveAttribute(
        "aria-sort",
        "ascending",
      )

      fireEvent.click(grid.getByRole("columnheader", { name: /Nama Produk/ }))
      await vi.waitFor(() => expect(lastSort()).toEqual({ by: "name", order: "asc" }))
    })

    it("mengurutkan kembali ke halaman pertama", async () => {
      api.route("GET /products", (call) => ({
        ...PRODUCTS,
        page: Number(call.query.get("page") ?? 1),
        total_pages: 3,
      }))
      const grid = await renderSorted()

      fireEvent.click(screen.getByRole("button", { name: /Selanjutnya/ }))
      await vi.waitFor(() => expect(api.lastCall("GET /products")?.query.get("page")).toBe("2"))

      fireEvent.click(grid.getByRole("columnheader", { name: /Barcode/ }))
      await vi.waitFor(() => expect(lastSort()).toEqual({ by: "barcode", order: "asc" }))
      expect(api.lastCall("GET /products")?.query.get("page")).toBe("1")
    })
  })

  // Sheet Radix diganti `Drawer`, jadi yang dijaga: isinya tetap muncul dan
  // penghapusan kategori tetap lewat konfirmasi.
  it("mengelola kategori lewat drawer, dengan konfirmasi sebelum menghapus", async () => {
    renderPage()

    await screen.findByText("Indomie Goreng")
    fireEvent.click(screen.getByRole("button", { name: "Kelola Kategori" }))

    const drawer = within(await screen.findByRole("dialog", { name: "Kelola Kategori" }))
    expect(drawer.getByText("Mie Instan")).toBeInTheDocument()
    expect(drawer.getByText("2 kategori")).toBeInTheDocument()

    // Tombol tambah hidup di dalam `TextField` yang sama dengan kolomnya, jadi
    // pastikan ia tidak ikut terseret jadi bagian dari kolom itu.
    const addButton = drawer.getByRole("button", { name: "Tambah Kategori" })
    expect(addButton).toBeDisabled()
    fireEvent.change(drawer.getByRole("textbox", { name: "Tambah Kategori" }), {
      target: { value: "Minuman" },
    })
    fireEvent.click(addButton)

    await vi.waitFor(() => {
      expect(api.lastCall("POST /categories")?.body).toEqual({ name: "Minuman" })
    })

    fireEvent.click(drawer.getByRole("button", { name: "Hapus Mie Instan" }))

    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText("Yakin ingin menghapus kategori ini?")).toBeInTheDocument()
    expect(api.callsFor("DELETE /categories/*")).toHaveLength(0)
  })

  it("menyunting kategori di tempat: fokus langsung ke kolom, Enter menyimpan", async () => {
    renderPage()

    await screen.findByText("Indomie Goreng")
    fireEvent.click(screen.getByRole("button", { name: "Kelola Kategori" }))

    const drawer = within(await screen.findByRole("dialog", { name: "Kelola Kategori" }))
    fireEvent.click(drawer.getByRole("button", { name: "Ubah Mie Instan" }))

    const field = drawer.getByRole("textbox", { name: "Ubah Mie Instan" })
    expect(field).toHaveFocus()

    fireEvent.change(field, { target: { value: "Mie & Bihun" } })
    fireEvent.keyDown(field, { key: "Enter" })

    await vi.waitFor(() => {
      const call = api.lastCall("PUT /categories/*")
      expect(call?.path).toBe("/categories/7")
      expect(call?.body).toEqual({ id: 7, name: "Mie & Bihun" })
    })
  })

  // Dialog Radix diganti `Modal`; langkah unggahnya yang harus tetap terpasang.
  it("membuka dialog import pada langkah unggah file", async () => {
    renderPage()

    await screen.findByText("Indomie Goreng")
    fireEvent.click(screen.getByRole("button", { name: "Import" }))

    const dialog = within(await screen.findByRole("dialog", { name: "Import Produk" }))
    expect(dialog.getByText("Klik untuk memilih file")).toBeInTheDocument()
    expect(dialog.getByRole("button", { name: "Download contoh template" })).toBeInTheDocument()
  })

  // Tabel preview pindah ke `Table` majemuk HeroUI. Kolomnya dibangun dari
  // header file, jadi bentuknya baru ketahuan setelah ada file yang dibaca.
  it("menampilkan preview import sebagai grid setelah file dibaca", async () => {
    renderPage()

    await screen.findByText("Indomie Goreng")
    fireEvent.click(screen.getByRole("button", { name: "Import" }))

    const dialog = await screen.findByRole("dialog", { name: "Import Produk" })
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement
    const csv = "Nama Produk,Harga Jual,Stok\nKopi Sachet,1500,10\n"
    fireEvent.change(fileInput, {
      target: { files: [new File([csv], "produk.csv", { type: "text/csv" })] },
    })

    const preview = within(await screen.findByRole("grid", { name: "Preview data import" }))
    expect(preview.getByRole("columnheader", { name: "Produk (Nama)" })).toBeInTheDocument()
    expect(preview.getByRole("columnheader", { name: "Harga Jual" })).toBeInTheDocument()
    expect(preview.getByRole("rowheader", { name: "Kopi Sachet" })).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: id.products.startImport })).toBeEnabled()
  })
})

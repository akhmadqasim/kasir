import type { SortDescriptor } from "@heroui/react"

import type { ProductQuickFilter, SearchProductsParams } from "./types"

/**
 * Pengurutan tabel produk, di antara `SortDescriptor` React Aria dan
 * `sort_by` / `sort_order` yang dibaca server.
 *
 * Kolomnya harus ada di allowlist `ProductSort` di
 * `src-tauri/src/services/products.rs`; nama yang tidak dikenal tidak
 * ditolak server, hanya dijatuhkan ke urutan bawaannya — jadi salah ketik di
 * sini tidak gagal, cuma diam-diam mengurutkan menurut nama.
 */

const SORT_COLUMNS = [
  "name",
  "barcode",
  "category",
  "sell_price",
  "stock",
  "created_at",
  "updated_at",
] as const

/** Kolom yang boleh dipakai `sort_by` — cermin allowlist `ProductSort` di server. */
export type ProductSortColumn = (typeof SORT_COLUMNS)[number]

export function isProductSortColumn(value: unknown): value is ProductSortColumn {
  return typeof value === "string" && (SORT_COLUMNS as readonly string[]).includes(value)
}

/**
 * Urutan sebelum pengguna memilih kolom: yang terbaru dulu, kecuali filter
 * stok — di situ yang paling menipis dulu, karena itulah yang dicari.
 */
export function defaultSort(quickFilter: ProductQuickFilter): SortDescriptor {
  if (quickFilter === "low_stock" || quickFilter === "negative_stock") {
    return { column: "stock", direction: "ascending" }
  }
  return { column: "created_at", direction: "descending" }
}

export function toSearchSort(
  descriptor: SortDescriptor,
): Pick<SearchProductsParams, "sort_by" | "sort_order"> {
  return {
    sort_by: isProductSortColumn(descriptor.column) ? descriptor.column : "name",
    sort_order: descriptor.direction === "descending" ? "desc" : "asc",
  }
}

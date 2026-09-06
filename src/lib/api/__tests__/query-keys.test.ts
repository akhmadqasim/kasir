import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"

import { queryKeys } from "../query-keys"

/**
 * Every invalidation in the app has to reach the queries it is meant to reach.
 *
 * This is the failure mode the move from Tauri command names to URLs invites,
 * and it is invisible: `invalidateQueries` that matches nothing is not an error
 * in React Query, it is a no-op. The screen just does not refresh. Nothing in
 * the type system catches it either — both sides are `readonly string[]`.
 *
 * So the pairs are written down. The left-hand side is a key some screen
 * actually registers a query under; the right-hand side is the key the mutation
 * that changes that data invalidates. If a key is renamed on one side only, one
 * of these fails.
 */

const RANGE = { startDate: "2026-09-01", endDate: "2026-09-06" }

const PAIRS: Array<{
  what: string
  query: readonly unknown[]
  invalidation: readonly unknown[]
}> = [
  // Products: saving one has to refresh both the catalogue and the shortcut grid.
  {
    what: "daftar produk setelah produk disimpan",
    query: queryKeys.products.search({ page: 1, per_page: 50 }),
    invalidation: queryKeys.products.all,
  },
  {
    what: "grid shortcut setelah produk disimpan",
    query: queryKeys.products.popular(30),
    invalidation: queryKeys.products.all,
  },
  // …but tracking a scan must reach *only* the shortcut grid.
  {
    what: "grid shortcut setelah produk dipilih di kasir",
    query: queryKeys.products.popular(30),
    invalidation: queryKeys.products.popularAll,
  },
  {
    what: "kategori setelah kategori disimpan",
    query: queryKeys.categories.list,
    invalidation: queryKeys.categories.all,
  },
  {
    what: "daftar pengguna setelah pengguna diubah",
    query: queryKeys.users.list,
    invalidation: queryKeys.users.all,
  },
  // Transactions: one prefix has to cover both the list and an open detail dialog.
  {
    what: "daftar transaksi setelah penjualan",
    query: queryKeys.transactions.list({ page: 1 }),
    invalidation: queryKeys.transactions.all,
  },
  {
    what: "detail transaksi setelah retry PPOB",
    query: queryKeys.transactions.detail(12),
    invalidation: queryKeys.transactions.all,
  },
  {
    what: "daftar retur setelah retur dibuat",
    query: queryKeys.refunds.list({ page: 1 }),
    invalidation: queryKeys.refunds.all,
  },
  {
    what: "detail retur setelah retur dibuat",
    query: queryKeys.refunds.detail(3),
    invalidation: queryKeys.refunds.all,
  },
  {
    what: "daftar write-off setelah write-off disetujui",
    query: queryKeys.stock.writeoffs({ page: 1, perPage: 50 }),
    invalidation: queryKeys.stock.all,
  },
  {
    what: "stok menipis di dashboard setelah write-off",
    query: queryKeys.dashboard.lowStock,
    invalidation: queryKeys.dashboard.lowStock,
  },
  {
    what: "ringkasan dashboard setelah penjualan",
    query: queryKeys.dashboard.summary,
    invalidation: queryKeys.dashboard.all,
  },
  {
    what: "shift aktif setelah penjualan",
    query: queryKeys.shifts.active,
    invalidation: queryKeys.shifts.all,
  },
  {
    what: "ringkasan shift setelah metode bayar diperbaiki",
    query: queryKeys.shifts.summary(4),
    invalidation: queryKeys.shifts.all,
  },
  // Reports are net of refunds, so a return has to move them all.
  {
    what: "laporan penjualan harian setelah retur",
    query: queryKeys.reports.salesDaily(RANGE),
    invalidation: queryKeys.reports.all,
  },
  {
    what: "laporan jenis pembayaran setelah metode bayar diperbaiki",
    query: queryKeys.reports.paymentMethods(RANGE),
    invalidation: queryKeys.reports.all,
  },
  {
    what: "status onboarding setelah onboarding selesai",
    query: queryKeys.onboarding.status,
    invalidation: queryKeys.onboarding.all,
  },
  {
    what: "info toko setelah info toko disimpan",
    query: queryKeys.settings.store,
    invalidation: queryKeys.settings.store,
  },
  {
    what: "pengaturan aplikasi setelah pengaturan disimpan",
    query: queryKeys.settings.app,
    invalidation: queryKeys.settings.app,
  },
  {
    what: "daftar backup setelah backup dibuat",
    query: queryKeys.backups.list,
    invalidation: queryKeys.backups.all,
  },
  {
    what: "status backup setelah backup dibuat",
    query: queryKeys.backups.status,
    invalidation: queryKeys.backups.all,
  },
  {
    what: "pengaturan printer setelah disimpan",
    query: queryKeys.printers.settings,
    invalidation: queryKeys.printers.settings,
  },
  {
    what: "daftar printer setelah tombol muat ulang",
    query: queryKeys.printers.list,
    invalidation: queryKeys.printers.list,
  },
  {
    what: "saldo PPOB setelah kredensial diganti",
    query: queryKeys.ppob.balance,
    invalidation: queryKeys.ppob.all,
  },
]

/** Seeds a query under `key` and reports whether `invalidation` marks it stale. */
function invalidates(query: readonly unknown[], invalidation: readonly unknown[]) {
  const client = new QueryClient()
  client.setQueryData(query, { seeded: true })
  client.invalidateQueries({ queryKey: invalidation })
  const state = client.getQueryCache().find({ queryKey: query })
  return state?.state.isInvalidated === true
}

describe("invalidasi mencapai query yang dituju", () => {
  it.each(PAIRS)("$what", ({ query, invalidation }) => {
    expect(invalidates(query, invalidation)).toBe(true)
  })
})

/**
 * The other half of the contract. A key that matches too much is not silent —
 * it refetches things nobody changed — but on the cashier screen it is the
 * difference between one request per scan and two.
 */
describe("invalidasi yang sempit tidak menyapu yang lain", () => {
  it("melacak pilihan produk tidak memuat ulang daftar pencarian", () => {
    expect(
      invalidates(
        queryKeys.products.search({ query: "indomie" }),
        queryKeys.products.popularAll
      )
    ).toBe(false)
  })

  it("menyimpan info toko tidak memuat ulang pengaturan aplikasi", () => {
    expect(invalidates(queryKeys.settings.app, queryKeys.settings.store)).toBe(false)
  })

  it("resource yang berbeda tidak saling menyentuh", () => {
    expect(invalidates(queryKeys.products.all, queryKeys.categories.all)).toBe(false)
    expect(invalidates(queryKeys.transactions.all, queryKeys.refunds.all)).toBe(false)
  })
})

/**
 * Two queries that differ only in their parameters have to be two cache
 * entries. `forceRefresh` on the PPOB inbox is the case that matters: a forced
 * read costs a vendor call, and letting it overwrite the cached plain read
 * would make the two indistinguishable afterwards.
 */
describe("parameter ikut membentuk kunci", () => {
  it("memisahkan pencarian dengan filter berbeda", () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.products.search({ page: 1 }), "halaman 1")
    client.setQueryData(queryKeys.products.search({ page: 2 }), "halaman 2")

    expect(client.getQueryData(queryKeys.products.search({ page: 1 }))).toBe("halaman 1")
    expect(client.getQueryData(queryKeys.products.search({ page: 2 }))).toBe("halaman 2")
  })

  it("memisahkan notifikasi PPOB yang dipaksa segar dari yang biasa", () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.ppob.notifications(1, 20, false), "cache")
    client.setQueryData(queryKeys.ppob.notifications(1, 20, true), "segar")

    expect(client.getQueryData(queryKeys.ppob.notifications(1, 20, false))).toBe("cache")
  })
})

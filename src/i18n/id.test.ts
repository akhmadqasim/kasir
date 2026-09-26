import { describe, expect, it } from "vitest"

import { id } from "./id"

describe("id phrase builders", () => {
  it("names the search text in a filtered-empty title", () => {
    expect(id.noMatch.query("produk", "gula")).toBe('Tidak ada produk yang cocok dengan "gula"')
  })

  it("keeps one shape for 'nothing recorded yet' across screens and reports", () => {
    expect(id.empty.backups).toBe("Belum ada backup")
    expect(id.empty.cashFlows).toBe("Belum ada uang masuk atau keluar")
    expect(id.reports.empty.cashFlows).toBe("Belum ada uang masuk atau keluar di periode ini")
    expect(id.reports.empty.salesInYear(2026)).toBe("Belum ada penjualan di tahun 2026")
  })

  it("says which data is still loading when a save is refused", () => {
    expect(id.notLoaded.storeInfo).toBe("Informasi toko belum dimuat, coba lagi sebentar")
  })

  it("reads every failed action as 'Gagal <kata kerja>: <alasan>'", () => {
    expect(id.shift.openFailed("Server sibuk")).toBe("Gagal membuka shift: Server sibuk")
    expect(id.shift.cashFlowFailed("Nominal kosong")).toBe(
      "Gagal mencatat uang masuk/keluar: Nominal kosong",
    )
    expect(id.ppobFulfillment.retryFailed("PIN salah")).toBe("Gagal mencoba ulang PPOB: PIN salah")
  })

  it("counts PPOB lines only when there is more than one", () => {
    expect(id.ppobFulfillment.retryPrompt(1)).toBe(
      "Masukkan PIN Mitra untuk mencoba ulang pembelian PPOB ini.",
    )
    expect(id.ppobFulfillment.retryPrompt(3)).toBe(
      "Masukkan PIN Mitra untuk mencoba ulang 3 pembelian PPOB yang gagal.",
    )
    expect(id.ppobFulfillment.retryStarted(1)).toBe("PPOB sedang diproses ulang di latar belakang")
    expect(id.ppobFulfillment.retryStarted(2)).toBe(
      "2 PPOB sedang diproses ulang di latar belakang",
    )
  })

  it("falls back to a generic subject when the PPOB line has no name", () => {
    expect(id.ppobFulfillment.resolveSuccessPrompt(undefined)).toBe(
      "Pastikan pembelian ini tercatat berhasil di riwayat Mitra.",
    )
    expect(id.ppobFulfillment.resolveFailedPrompt("Token PLN 20K")).toMatch(
      /^Pastikan Token PLN 20K tidak ada atau gagal di riwayat Mitra\./,
    )
  })

  it("mentions the parked cart only when a recall replaced a non-empty one", () => {
    expect(id.cashier.cartRecalled("Bu Ani", false)).toBe("Bu Ani dilanjutkan")
    expect(id.cashier.cartRecalled("Bu Ani", true)).toBe(
      'Bu Ani dilanjutkan. Keranjang sebelumnya disimpan sebagai "Keranjang Aktif".',
    )
    expect(id.cashier.heldCartDeleted(undefined)).toBe("Transaksi tersimpan dihapus")
  })
})

import type { StatusVariant } from "@/components/status-badge"
import { id } from "@/i18n/id"

/**
 * Label metode pembayaran, satu-satunya sumber untuk seluruh aplikasi.
 *
 * Daftarnya harus mencakup semua nilai yang diterima kolom `payment_method` sejak
 * migrasi 014 — termasuk `debit` dan `mixed`. Layar yang menyalin peta ini sebelumnya
 * ketinggalan dua nilai itu dan mencetak string mentah "debit" / "mixed" ke kasir.
 */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: id.payment.cash,
  qris: id.payment.qris,
  debit: id.payment.debit,
  ewallet: id.payment.ewallet,
  transfer: id.payment.transfer,
  mixed: id.payment.mixed,
}

/**
 * Metode yang boleh disimpan ke `transactions.payment_method` lewat
 * `update_payment_method`, sama persis dengan `VALID_PAYMENT_METHODS` di
 * `commands/transactions.rs`.
 *
 * `mixed` sengaja tidak ada di sini: itu status turunan dari beberapa baris
 * `transaction_payments`, bukan metode yang bisa dipilih, dan backend menolaknya
 * dengan "Metode pembayaran tidak valid: mixed".
 */
export const SELECTABLE_PAYMENT_METHODS = ["cash", "qris", "debit", "ewallet", "transfer"] as const

export type SelectablePaymentMethod = (typeof SELECTABLE_PAYMENT_METHODS)[number]

export function isSelectablePaymentMethod(
  method: string | null | undefined,
): method is SelectablePaymentMethod {
  return SELECTABLE_PAYMENT_METHODS.includes(method as SelectablePaymentMethod)
}

/** Nilai yang tidak dikenal ditampilkan apa adanya, bukan disembunyikan. */
export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method
}

/**
 * Warna grafik per metode, dipatok bukan dibagikan menurut urutan kemunculan
 * (DESIGN.md §3.3).
 *
 * Kalau warnanya diambil berurutan dari data, satu hari tanpa QRIS akan
 * menggeser seluruh warna dan kasir yang hafal "garis biru itu tunai" membaca
 * grafik yang salah. `mixed` sengaja abu-abu: ia bukan metode yang bisa
 * dipilih, melainkan penanda transaksi yang dibayar dengan beberapa metode.
 *
 * Tinggal di sini, bersebelahan dengan labelnya, supaya dashboard dan laporan
 * membaca satu peta yang sama — laporan pernah menyimpan salinan yang
 * tertinggal.
 */
export const METHOD_COLORS: Record<string, string> = {
  cash: "var(--chart-1)",
  qris: "var(--chart-2)",
  debit: "var(--chart-3)",
  ewallet: "var(--chart-4)",
  transfer: "var(--chart-5)",
  mixed: "var(--muted)",
}

/** Metode di luar daftar tetap tergambar, memakai warna aksen. */
export function paymentMethodColor(method: string): string {
  return METHOD_COLORS[method] ?? "var(--accent)"
}

/**
 * "Transfer (BCA)" — untuk baris split yang menyimpan nama bank. `mixed` tidak
 * pernah membawa nama bank: itu gabungan beberapa baris, dan bank baris
 * pertama saja ("Campuran (GoPay)") menyesatkan.
 */
export function paymentSplitLabel(method: string, bankName?: string | null): string {
  const label = paymentMethodLabel(method)
  if (method === "mixed") return label
  return bankName?.trim() ? `${label} (${bankName.trim()})` : label
}

/** Label status transaksi, mencakup seluruh nilai yang bisa ditulis backend. */
export const TRANSACTION_STATUS_LABELS: Record<string, string> = {
  completed: id.transactions.completed,
  pending_ppob: id.transactions.pendingPpob,
  ppob_failed: id.transactions.ppobFailed,
  refunded: id.transactions.refunded,
  partial_refund: id.transactions.partialRefund,
  deleted: id.transactions.deleted,
}

export function transactionStatusLabel(status: string): string {
  return TRANSACTION_STATUS_LABELS[status] ?? status
}

/**
 * Status transaksi diterjemahkan ke kosakata {@link StatusBadge}: layar menyebut
 * *artinya*, bukan warnanya, dan `status-badge.tsx` yang memutuskan tampilannya.
 *
 * Status yang tidak dikenal jatuh ke `neutral` — sama seperti label-nya yang
 * ditampilkan apa adanya, bukan disembunyikan.
 */
export const TRANSACTION_STATUS_VARIANT: Record<string, StatusVariant> = {
  completed: "success",
  pending_ppob: "warning",
  ppob_failed: "error",
  refunded: "error",
  partial_refund: "neutral",
  deleted: "error",
}

export function transactionStatusVariant(status: string): StatusVariant {
  return TRANSACTION_STATUS_VARIANT[status] ?? "neutral"
}

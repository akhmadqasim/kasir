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
export const SELECTABLE_PAYMENT_METHODS = [
  "cash",
  "qris",
  "debit",
  "ewallet",
  "transfer",
] as const

export type SelectablePaymentMethod = (typeof SELECTABLE_PAYMENT_METHODS)[number]

export function isSelectablePaymentMethod(
  method: string | null | undefined
): method is SelectablePaymentMethod {
  return SELECTABLE_PAYMENT_METHODS.includes(method as SelectablePaymentMethod)
}

/** Nilai yang tidak dikenal ditampilkan apa adanya, bukan disembunyikan. */
export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method
}

/** "Transfer Bank (BCA)" — untuk baris split yang menyimpan nama bank. */
export function paymentSplitLabel(
  method: string,
  bankName?: string | null
): string {
  const label = paymentMethodLabel(method)
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

/** Varian `Badge` untuk status transaksi di riwayat transaksi dan dialog detailnya. */
export const TRANSACTION_STATUS_VARIANTS: Record<
  string,
  "default" | "destructive" | "secondary"
> = {
  completed: "default",
  pending_ppob: "secondary",
  ppob_failed: "destructive",
  refunded: "destructive",
  partial_refund: "secondary",
  deleted: "destructive",
}

/** Warna tambahan di atas varian `Badge`, untuk status yang perlu dibedakan sekilas. */
export const TRANSACTION_STATUS_CLASSNAMES: Record<string, string> = {
  completed: "bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300",
  pending_ppob: "bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  deleted: "bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300",
}

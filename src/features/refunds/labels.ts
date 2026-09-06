import type { StatusVariant } from "@/components/status-badge"
import { id } from "@/i18n/id"

/**
 * Tampilan sebuah refund, dinyatakan dalam kosakata `StatusBadge`.
 *
 * Riwayat refund dan dialog detailnya dulu menyimpan salinan sendiri berisi
 * `bg-blue-50 text-blue-700 …`. Dua salinan itu sudah sempat berbeda, dan tidak
 * satu pun punya cerita untuk dark mode. Sekarang kedua layar menyebut *artinya*
 * dan `components/status-badge.tsx` yang memilih warnanya.
 */
export function refundTypeVariant(refundType: string): StatusVariant {
  return refundType === "exchange" ? "info" : "neutral"
}

export function refundTypeLabel(refundType: string): string {
  return refundType === "exchange" ? id.refund.typeExchange : id.refund.typeRefund
}

const CONDITION_VARIANT: Record<string, StatusVariant> = {
  good: "success",
  damaged: "error",
  expired: "warning",
}

const CONDITION_LABEL: Record<string, string> = {
  good: id.refund.conditionGood,
  damaged: id.refund.conditionDamaged,
  expired: id.refund.conditionExpired,
}

/** `null` untuk baris tanpa kondisi tercatat — dialog menampilkan "—". */
export function refundConditionBadge(
  condition: string | null | undefined,
): { label: string; variant: StatusVariant } | null {
  if (!condition) return null
  const label = CONDITION_LABEL[condition]
  if (!label) return null
  return { label, variant: CONDITION_VARIANT[condition] ?? "neutral" }
}

/**
 * Selisih tukar barang: positif berarti toko mengembalikan uang, negatif berarti
 * pelanggan menambah bayar. Nol tidak perlu ditonjolkan.
 */
export function differenceToneClass(amount: number): string {
  if (amount > 0) return "text-success"
  if (amount < 0) return "text-danger"
  return "text-muted"
}

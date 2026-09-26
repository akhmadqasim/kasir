import type { StatusVariant } from "@/components/status-badge"
import { id } from "@/i18n/id"
import type { RefundCondition } from "./types"

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

const CONDITION_VARIANT: Record<RefundCondition, StatusVariant> = {
  good: "success",
  damaged: "error",
  expired: "warning",
}

const CONDITION_LABEL: Record<RefundCondition, string> = {
  good: id.refund.conditionGood,
  damaged: id.refund.conditionDamaged,
  expired: id.refund.conditionExpired,
}

const REFUND_CONDITIONS: readonly RefundCondition[] = ["good", "damaged", "expired"]

/** Pilihan kondisi barang retur untuk form refund. */
export const REFUND_CONDITION_OPTIONS = REFUND_CONDITIONS.map((key) => ({
  key,
  label: CONDITION_LABEL[key],
}))

/** Menyempitkan kunci dari `Select` menjadi kondisi yang dikenal backend. */
export function isRefundCondition(value: string | null): value is RefundCondition {
  return REFUND_CONDITIONS.some((condition) => condition === value)
}

/** `null` untuk baris tanpa kondisi tercatat — dialog menampilkan "—". */
export function refundConditionBadge(
  condition: string | null | undefined,
): { label: string; variant: StatusVariant } | null {
  // The guard, not a plain lookup: `CONDITION_LABEL["toString"]` is truthy.
  if (!condition || !isRefundCondition(condition)) return null
  return { label: CONDITION_LABEL[condition], variant: CONDITION_VARIANT[condition] }
}

/**
 * Selisih tukar barang: positif berarti toko mengembalikan uang, negatif berarti
 * pelanggan menambah bayar. Nol tidak perlu ditonjolkan.
 */
export function differenceTone(amount: number): "success" | "danger" | null {
  if (amount > 0) return "success"
  if (amount < 0) return "danger"
  return null
}

/**
 * Arah uang selisih dalam kata-kata, supaya warnanya tidak berdiri sendiri
 * (DESIGN.md §7). `null` bila tidak ada selisih.
 */
export function differenceDirectionLabel(amount: number): string | null {
  if (amount > 0) return id.refund.differenceStoreReturns
  if (amount < 0) return id.refund.differenceCustomerPays
  return null
}

export function differenceToneClass(amount: number): string {
  const tone = differenceTone(amount)
  if (tone === "success") return "text-success"
  if (tone === "danger") return "text-danger"
  return "text-muted"
}

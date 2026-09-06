import { id as t } from "@/i18n/id"

/**
 * Rentang waktu yang bisa dipilih, beserta jumlah hari yang dikirim ke backend.
 *
 * Satu daftar untuk seluruh dashboard: grafik penjualan dan grafik metode
 * pembayaran menggambar periode yang sama, jadi keduanya membaca dari sini dan
 * tidak mungkin lagi tampil dengan rentang berbeda tanpa ada yang menyadarinya.
 */
export const TIME_RANGE_OPTIONS = [
  { key: "7d", label: t.dashboard.last1Week, days: 7 },
  { key: "1m", label: t.dashboard.last1Month, days: 30 },
  { key: "3m", label: t.dashboard.last3Months, days: 90 },
  { key: "6m", label: t.dashboard.last6Months, days: 180 },
  { key: "1y", label: t.dashboard.last1Year, days: 365 },
] as const

export type TimeRangeKey = (typeof TIME_RANGE_OPTIONS)[number]["key"]

/** Hari untuk sebuah kunci rentang; kunci asing jatuh ke 7 hari. */
export function daysForRange(key: string): number {
  return TIME_RANGE_OPTIONS.find((option) => option.key === key)?.days ?? 7
}

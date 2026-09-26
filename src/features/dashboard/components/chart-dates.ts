import { parseCalendarDay } from "@/features/reports/calendar-day"

/**
 * Label tanggal untuk kedua grafik dashboard. Satu tempat, supaya sumbu grafik
 * penjualan dan grafik metode pembayaran tidak bisa memformat hari yang sama
 * dengan dua cara. Titik grafiknya "YYYY-MM-DD", dibaca sebagai hari lokal.
 */

function formatChartDay(value: string, options: Intl.DateTimeFormatOptions): string {
  return parseCalendarDay(value)?.toLocaleDateString("id-ID", options) ?? value
}

/** "5 Sep" — cukup untuk sumbu, tanpa tahun yang selalu sama. */
export function shortDate(value: string): string {
  return formatChartDay(value, { month: "short", day: "numeric" })
}

/** "5 September 2026" — untuk tooltip, tempat ruangnya ada. */
export function longDate(value: string): string {
  return formatChartDay(value, { day: "numeric", month: "long", year: "numeric" })
}

/**
 * Tanggal yang diberi label di sumbu-x, paling banyak `maxLabels`.
 *
 * Dengan `minTickGap` bawaan recharts sendiri yang memilih label mana yang
 * dibuang, dan pilihannya bergeser mengikuti lebar grafik — satu tanggal
 * tiba-tiba hilang di tengah deret. Di sini jaraknya tetap: setiap `step`
 * hari, dihitung mundur dari hari terakhir, supaya hari ini selalu berlabel
 * dan jarak antarlabel sama. Tujuh label muat di grafik selebar apa pun yang
 * dipakai dashboard, jadi tidak ada yang bertumpuk. Label terakhir berada di
 * tepi kanan, maka kedua grafik memberi `margin.right` 20px supaya tidak terpotong.
 */
export function dayTicks(dates: readonly string[], maxLabels = 7): string[] {
  if (dates.length <= maxLabels) return [...dates]
  const step = Math.ceil((dates.length - 1) / (maxLabels - 1))
  const last = dates.length - 1
  return dates.filter((_, index) => (last - index) % step === 0)
}

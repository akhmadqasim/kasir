/**
 * Label tanggal untuk kedua grafik dashboard. Satu tempat, supaya sumbu grafik
 * penjualan dan grafik metode pembayaran tidak bisa memformat hari yang sama
 * dengan dua cara.
 */

/** "5 Sep" — cukup untuk sumbu, tanpa tahun yang selalu sama. */
export function shortDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("id-ID", {
    month: "short",
    day: "numeric",
  })
}

/** "5 September 2026" — untuk tooltip, tempat ruangnya ada. */
export function longDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

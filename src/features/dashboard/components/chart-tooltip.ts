import { formatRupiah } from "@/lib/format"

/**
 * `formatter` tooltip kedua grafik dashboard: nilainya saja, sebagai rupiah.
 *
 * Penanda warna dan nama seri sudah digambar `ChartTooltipContent` dari
 * `ChartConfig` grafiknya. Formatter yang mengembalikan satu baris utuh
 * (penanda + label + nilai) membuat keduanya muncul dua kali di tiap baris.
 */
export function rupiahTooltipValue(value: unknown): string {
  return formatRupiah(Number(value))
}

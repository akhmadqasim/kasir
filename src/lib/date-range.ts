import type { DateRange } from "react-day-picker"

/**
 * Tipe rentang tanggal yang dipakai seluruh layar filter. Sengaja di-re-export dari
 * sini, bukan diimpor langsung dari `react-day-picker`, supaya penggantian ke
 * `DateRangePicker` HeroUI — yang memakai `CalendarDate` dari
 * `@internationalized/date`, bukan `Date` bawaan JS — hanya menyentuh modul ini dan
 * `@/components/date-range-picker`.
 */
export type { DateRange }

/** Panjang rentang default laporan, dalam hari sebelum hari ini. */
export const DEFAULT_RANGE_DAYS = 30

/**
 * Rentang default laporan: `days` hari terakhir sampai hari ini, inklusif di kedua
 * ujungnya. Dipakai sebagai initializer `useState` sehingga tanggalnya dihitung saat
 * layar dibuka, bukan saat modul dimuat.
 */
export function getDefaultDateRange(days: number = DEFAULT_RANGE_DAYS): DateRange {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { from, to }
}

/** Rentang "hari ini saja", default untuk layar riwayat transaksi dan refund. */
export function getTodayRange(): DateRange {
  return { from: new Date(), to: new Date() }
}

/**
 * Menerjemahkan hasil seleksi `react-day-picker` menjadi rentang yang selalu terisi.
 *
 * `addToRange` di `react-day-picker@9` mengembalikan `undefined` ketika hari yang
 * diklik sama dengan kedua ujung rentang — cabang `isSameDay(from, date) &&
 * isSameDay(to, date)` menghapus seluruh pilihan selama `required` tidak diset. Klik
 * kedua pada tanggal yang sama karena itu mengosongkan filter, `startDate` terkirim
 * kosong, dan setiap laporan menampilkan "Tidak ada data" tanpa pesan error.
 *
 * Klik pada satu tanggal paling wajar dibaca sebagai "tampilkan hari itu saja", jadi
 * pilihan yang dikosongkan dikembalikan menjadi rentang satu hari pada tanggal yang
 * diklik. Rentang setengah jadi (`from` terisi, `to` belum) dibiarkan apa adanya —
 * itu langkah normal saat memilih dua tanggal, dan pemanggilnya sudah membaca `to`
 * yang kosong sebagai "sama dengan `from`".
 */
export function resolveRangeSelection(
  range: DateRange | undefined,
  triggerDate: Date
): DateRange {
  return range?.from ? range : { from: triggerDate, to: triggerDate }
}

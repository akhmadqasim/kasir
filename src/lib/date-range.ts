import { CalendarDate, type DateValue } from "@internationalized/date"

/**
 * Tipe rentang tanggal yang dipakai seluruh layar filter.
 *
 * Bentuknya sengaja dipertahankan apa adanya dari `react-day-picker` — `from`
 * wajib ada tapi boleh `undefined`, `to` opsional — supaya dua belas layar yang
 * membacanya tidak ikut berubah saat pickernya pindah ke HeroUI. Yang berubah
 * hanya di sini: tipenya kini milik modul ini sendiri, bukan re-export dari
 * dependensi yang sudah dibuang.
 *
 * HeroUI `DateRangePicker` bekerja dengan `CalendarDate` dari
 * `@internationalized/date`, bukan `Date` bawaan JS. Penerjemahannya dikurung di
 * {@link toCalendarDateRange} dan {@link fromCalendarDateRange} sehingga tidak
 * ada layar lain yang perlu tahu tipe itu ada.
 */
export interface DateRange {
  from: Date | undefined
  to?: Date | undefined
}

/** Rentang React Aria. Kedua ujungnya wajib terisi — tidak ada rentang setengah jadi. */
export interface CalendarDateRange {
  start: CalendarDate
  end: CalendarDate
}

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
 * Menerjemahkan hasil seleksi kalender menjadi rentang yang selalu terisi.
 *
 * Kalender bisa mengembalikan pilihan kosong: `react-day-picker` melakukannya
 * saat hari yang diklik sama dengan kedua ujung rentang, dan `DateRangePicker`
 * HeroUI mengirim `null` begitu segmen tanggalnya dihapus dengan Backspace. Dua
 * jalan berbeda, akibat yang sama: `startDate` terkirim kosong, dan setiap
 * laporan menampilkan "Tidak ada data" tanpa pesan error.
 *
 * Satu tanggal paling wajar dibaca sebagai "tampilkan hari itu saja", jadi
 * pilihan yang dikosongkan dikembalikan menjadi rentang satu hari pada
 * `triggerDate` — tanggal yang baru saja disentuh kasir. Rentang setengah jadi
 * (`from` terisi, `to` belum) dibiarkan apa adanya: itu langkah normal saat
 * memilih dua tanggal, dan pemanggilnya sudah membaca `to` yang kosong sebagai
 * "sama dengan `from`".
 */
export function resolveRangeSelection(range: DateRange | undefined, triggerDate: Date): DateRange {
  return range?.from ? range : { from: triggerDate, to: triggerDate }
}

/** Hari kalender lokal sebuah `Date`, tanpa jam dan tanpa zona waktu. */
function toCalendarDate(date: Date): CalendarDate {
  return new CalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

/**
 * `Date` tengah malam waktu lokal. Dibangun dari komponen tanggalnya, bukan lewat
 * `toDate(timeZone)`, supaya hari yang tampil di kalender sama persis dengan hari
 * yang dibaca `toLocalDateString` saat filter dikirim ke backend.
 */
function toLocalDate(value: DateValue): Date {
  return new Date(value.year, value.month - 1, value.day)
}

/**
 * Rentang aplikasi → rentang React Aria.
 *
 * Rentang setengah jadi dinaikkan jadi rentang satu hari: React Aria tidak punya
 * cara menampilkan ujung yang kosong, dan layar yang memanggilnya memang sudah
 * membaca `to` kosong sebagai "sama dengan `from`".
 */
export function toCalendarDateRange(range: DateRange | undefined): CalendarDateRange | null {
  if (!range?.from) return null
  const start = toCalendarDate(range.from)
  return { start, end: range.to ? toCalendarDate(range.to) : start }
}

/** Rentang React Aria → rentang aplikasi. `null` berarti pilihan dikosongkan. */
export function fromCalendarDateRange(
  value: { start: DateValue; end: DateValue } | null,
): DateRange | undefined {
  if (!value) return undefined
  return { from: toLocalDate(value.start), to: toLocalDate(value.end) }
}

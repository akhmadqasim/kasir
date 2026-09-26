import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale"

import { formatDayDate } from "@/lib/format"

/**
 * Hari kalender yang dikirim backend tanpa jam: "YYYY-MM-DD" untuk baris laporan
 * harian dan titik grafik dashboard, "YYYY-MM" untuk laporan bulanan. Backend
 * sudah mengelompokkannya per hari *lokal* (`date(created_at, 'localtime')`).
 *
 * `new Date("2026-09-05")` membaca string tanggal ISO sebagai tengah malam UTC,
 * yang di zona waktu di belakang UTC jatuh ke hari sebelumnya — dan
 * `formatDayDate` meneruskannya apa adanya. Semua string tanggal-saja di laporan
 * dan dashboard karena itu dibaca lewat sini, sebagai tengah malam waktu lokal.
 */

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** "2026-09-05" → tengah malam lokal 5 September 2026; `null` untuk bentuk lain. */
export function parseCalendarDay(value: string): Date | null {
  const match = CALENDAR_DAY.exec(value.trim())
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)
  // `new Date(2026, 1, 31)` diam-diam bergeser ke 3 Maret; tanggal seperti itu bukan tanggal.
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

/**
 * "Sab, 5 Sep 2026" dari "2026-09-05" — bentuk yang sama dengan kolom tanggal
 * lain di laporan. Tanggalnya diteruskan ke `formatDayDate` sebagai instan
 * berzona (`toISOString`), yang dicetaknya kembali di zona lokal, jadi formatnya
 * tetap satu sumber. String yang bukan tanggal-saja diserahkan langsung.
 */
export function formatCalendarDay(value: string, fallback = "—"): string {
  const date = parseCalendarDay(value)
  return formatDayDate(date ? date.toISOString() : value, fallback)
}

/** "September 2026" dari "2026-09"; string lain dikembalikan apa adanya. */
export function formatCalendarMonth(month: string): string {
  const date = parseCalendarDay(`${month}-01`)
  return date ? format(date, "MMMM yyyy", { locale: idLocale }) : month
}

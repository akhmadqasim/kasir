import { useState } from "react"

import { getDefaultDateRange, type DateRange } from "@/lib/date-range"
import { toLocalDateString } from "@/lib/format"

/**
 * State rentang tanggal sebuah laporan beserta bentuknya untuk query.
 *
 * Sembilan layar laporan menulis tiga baris yang sama: `useState` dengan
 * rentang default, lalu `startDate`/`endDate` sebagai string lokal, dengan
 * `endDate` jatuh ke `startDate` selama rentangnya masih setengah jadi. Ditulis
 * sekali di sini supaya aturan "satu tanggal = satu hari" tidak bisa berbeda
 * antar laporan.
 */
export function useReportDateRange() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange)

  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : ""
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : startDate

  return { dateRange, setDateRange, startDate, endDate }
}

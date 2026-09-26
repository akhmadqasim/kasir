import { useState } from "react"

import type { DateRange } from "@/lib/date-range"
import { toLocalDateString } from "@/lib/format"
import { getDefaultDateRange, getDefaultDateRangeDates } from "./history-utils"

/**
 * The picker's range plus the `YYYY-MM-DD` bounds the vendor endpoints take,
 * defaulting to the last seven local days while either end is unset.
 */
export function useLocalDateRange() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRangeDates)

  // The picker holds local dates; `toISOString()` here would send yesterday.
  const defaults = getDefaultDateRange()
  const startDate = dateRange?.from ? toLocalDateString(dateRange.from) : defaults.start
  const endDate = dateRange?.to ? toLocalDateString(dateRange.to) : defaults.end

  return { dateRange, setDateRange, startDate, endDate }
}

import { describe, expect, it } from "vitest"

import { formatDayDate } from "@/lib/format"
import { formatCalendarDay, formatCalendarMonth, parseCalendarDay } from "./calendar-day"

describe("hari kalender dari backend", () => {
  it("membaca YYYY-MM-DD sebagai tengah malam lokal, bukan UTC", () => {
    const date = parseCalendarDay("2026-09-05")
    expect(date).not.toBeNull()
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(8)
    expect(date?.getDate()).toBe(5)
    expect(date?.getHours()).toBe(0)
  })

  it("menolak bentuk lain dan tanggal yang tidak ada", () => {
    expect(parseCalendarDay("2026-09-05 10:00:00")).toBeNull()
    expect(parseCalendarDay("2026-02-31")).toBeNull()
    expect(parseCalendarDay("bukan tanggal")).toBeNull()
  })

  it("mencetak hari yang sama dengan yang dikirim backend", () => {
    // Siang lokal di hari itu: tidak bisa bergeser hari di zona mana pun.
    const localNoon = new Date(2026, 8, 5, 12).toISOString()
    expect(formatCalendarDay("2026-09-05")).toBe(formatDayDate(localNoon))
    expect(formatCalendarDay("2026-09-05")).toContain("5")
  })

  it("menyerahkan timestamp dan string rusak ke formatDayDate", () => {
    expect(formatCalendarDay("2026-09-05 18:00:00")).toBe(formatDayDate("2026-09-05 18:00:00"))
    expect(formatCalendarDay("bukan tanggal", "-")).toBe("-")
  })

  it("menamai bulan dari YYYY-MM", () => {
    expect(formatCalendarMonth("2026-09")).toBe("September 2026")
    expect(formatCalendarMonth("rusak")).toBe("rusak")
  })
})

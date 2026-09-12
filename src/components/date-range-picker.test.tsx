import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"

import { DateRangePicker } from "./date-range-picker"
import type { DateRange } from "@/lib/date-range"

const SEPTEMBER_2026: DateRange = {
  from: new Date(2026, 8, 1),
  to: new Date(2026, 8, 30),
}

/** Satu-satunya tombol sebelum popover terbuka: pemicu kalender. */
function openCalendar() {
  fireEvent.click(screen.getByRole("button"))
}

/** Sel tanggal React Aria adalah tombol berisi angka harinya saja. */
function dayCell(grid: HTMLElement, day: string) {
  return within(grid)
    .getAllByRole("button")
    .find((cell) => cell.textContent?.trim() === day)!
}

describe("DateRangePicker", () => {
  it("shows the selected range in the date field", () => {
    render(<DateRangePicker value={SEPTEMBER_2026} onChange={vi.fn()} />)

    // `id-ID` menaruh hari sebelum bulan; tanpa I18nProvider urutannya terbalik.
    const segments = screen.getAllByRole("spinbutton")
    expect(segments[0]).toHaveTextContent("1")
    expect(segments[1]).toHaveTextContent("9")
    expect(segments[2]).toHaveTextContent("2026")
  })

  it("opens two months side by side", async () => {
    render(<DateRangePicker value={SEPTEMBER_2026} onChange={vi.fn()} />)

    openCalendar()

    expect(await screen.findAllByRole("grid")).toHaveLength(2)
  })

  it("reads two clicks on the same day as a single-day range", async () => {
    const onChange = vi.fn()
    render(<DateRangePicker value={SEPTEMBER_2026} numberOfMonths={1} onChange={onChange} />)

    openCalendar()
    const grid = await screen.findByRole("grid")

    fireEvent.click(dayCell(grid, "15"))
    fireEvent.click(dayCell(grid, "15"))

    expect(onChange).toHaveBeenCalled()
    const range = onChange.mock.lastCall![0] as DateRange
    expect(range.from).toEqual(new Date(2026, 8, 15))
    expect(range.to).toEqual(new Date(2026, 8, 15))
  })
})

import { describe, expect, it } from "vitest"

import { dayTicks } from "./components/chart-dates"

function days(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `d${index}`)
}

describe("dayTicks", () => {
  it("labels every day when the range is short", () => {
    expect(dayTicks(days(7))).toEqual(days(7))
    expect(dayTicks([])).toEqual([])
  })

  it("keeps the last day and an even step for longer ranges", () => {
    for (const count of [30, 90, 180, 365]) {
      const ticks = dayTicks(days(count))
      expect(ticks.length).toBeLessThanOrEqual(7)
      expect(ticks.length).toBeGreaterThanOrEqual(5)
      expect(ticks.at(-1)).toBe(`d${count - 1}`)
      const indexes = ticks.map((tick) => Number(tick.slice(1)))
      const gaps = new Set(indexes.slice(1).map((value, i) => value - indexes[i]))
      expect(gaps.size).toBe(1)
    }
  })
})

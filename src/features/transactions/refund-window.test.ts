import { describe, expect, it } from "vitest"
import {
  REFUND_MAX_DAYS,
  isWithinRefundWindow,
  refundBlockedReason,
  refundWindowState,
} from "./refund-window"

// Backend timestamps are UTC without a zone marker; `parseBackendDate` pins them.
const SOLD_AT = "2026-09-01 10:00:00"
const soldAtMs = Date.parse("2026-09-01T10:00:00Z")

function at(offsetMs: number): Date {
  return new Date(soldAtMs + offsetMs)
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe("refundWindowState", () => {
  it("is open right after the sale", () => {
    expect(refundWindowState(SOLD_AT, at(HOUR))).toBe("open")
  })

  // The backend compares durations, so the window closes at exactly 168 hours —
  // not at the end of the seventh calendar day, which is what `num_days()` gave.
  it("is still open one minute before the window closes", () => {
    expect(refundWindowState(SOLD_AT, at(REFUND_MAX_DAYS * DAY - 60_000))).toBe("open")
  })

  it("is open at exactly seven days, matching `age > 7 days`", () => {
    expect(refundWindowState(SOLD_AT, at(REFUND_MAX_DAYS * DAY))).toBe("open")
  })

  it("is expired one second past seven days", () => {
    expect(refundWindowState(SOLD_AT, at(REFUND_MAX_DAYS * DAY + 1000))).toBe("expired")
  })

  it("does not stretch to almost eight days the way whole-day maths did", () => {
    expect(refundWindowState(SOLD_AT, at(7 * DAY + 23 * HOUR))).toBe("expired")
  })

  it("treats a missing timestamp as not refundable, like the backend", () => {
    expect(refundWindowState(null)).toBe("unknown")
    expect(refundWindowState(undefined)).toBe("unknown")
    expect(refundWindowState("")).toBe("unknown")
  })
})

describe("isWithinRefundWindow", () => {
  it("only accepts an open window", () => {
    expect(isWithinRefundWindow(SOLD_AT, at(DAY))).toBe(true)
    expect(isWithinRefundWindow(SOLD_AT, at(8 * DAY))).toBe(false)
    expect(isWithinRefundWindow(null)).toBe(false)
  })
})

describe("refundBlockedReason", () => {
  it("says nothing while the window is open", () => {
    expect(refundBlockedReason(SOLD_AT, at(DAY))).toBeNull()
  })

  it("names the seven-day limit once it has passed", () => {
    expect(refundBlockedReason(SOLD_AT, at(8 * DAY))).toContain("7 hari")
  })

  it("explains a missing date separately", () => {
    expect(refundBlockedReason(null)).toContain("tanpa tanggal")
  })
})

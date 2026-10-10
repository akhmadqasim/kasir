import { describe, expect, it } from "vitest"
import {
  REFUND_MAX_DAYS,
  isLineInsideRefundWindow,
  refundActionBlockedReason,
  refundBlockedReason,
  refundWindowState,
} from "../refund-window"

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

describe("a failed PPOB top-up has no refund window", () => {
  const owed = { product_id: null, refundable_quantity: 1 }
  const goods = { product_id: 4, refundable_quantity: 1 }

  it("lets only that line through once the window has passed", () => {
    const late = at(8 * DAY)
    expect(isLineInsideRefundWindow(owed, SOLD_AT, late)).toBe(true)
    expect(isLineInsideRefundWindow({ ...owed, refundable_quantity: 0 }, SOLD_AT, late)).toBe(false)
    expect(isLineInsideRefundWindow(goods, SOLD_AT, late)).toBe(false)
    expect(isLineInsideRefundWindow(goods, SOLD_AT, at(DAY))).toBe(true)
  })
})

describe("refundActionBlockedReason", () => {
  const owed = { hasRefundableFailedPpob: true }
  const none = { hasRefundableFailedPpob: false }

  it("lets a pure refund of a failed top-up past the window", () => {
    expect(
      refundActionBlockedReason(SOLD_AT, { ...owed, action: "refund" }, at(8 * DAY)),
    ).toBeNull()
  })

  // Mirrors `check_refund_window`: an exchange sends new goods out, so a failed
  // top-up does not lift the window for it.
  it("keeps an exchange inside the window even when a failed top-up is owed", () => {
    const reason = refundActionBlockedReason(SOLD_AT, { ...owed, action: "exchange" }, at(8 * DAY))
    expect(reason).toContain("7 hari")
    expect(reason).toContain("tukar barang")
  })

  it("leaves an exchange open inside the window", () => {
    expect(refundActionBlockedReason(SOLD_AT, { ...owed, action: "exchange" }, at(DAY))).toBeNull()
  })

  it("falls back to the plain window when no top-up is owed", () => {
    for (const action of ["refund", "exchange"] as const) {
      expect(refundActionBlockedReason(SOLD_AT, { ...none, action }, at(8 * DAY))).toBe(
        refundBlockedReason(SOLD_AT, at(8 * DAY)),
      )
    }
    expect(refundActionBlockedReason(null, { ...owed, action: "exchange" })).toContain(
      "tanpa tanggal",
    )
  })
})

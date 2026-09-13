import { describe, expect, it } from "vitest"
import type { HistoryPaymentItem } from "../../types"
import {
  getProviderTotal,
  isWithinLocalDateRange,
  normalizeStatus,
  parseMutasiDate,
} from "./history-utils"

describe("parseMutasiDate", () => {
  // Payment history shape.
  it("reads a year-first timestamp", () => {
    const date = parseMutasiDate("2026-09-05 14:30:00")
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(8)
    expect(date?.getDate()).toBe(5)
    expect(date?.getHours()).toBe(14)
  })

  // `formatted_date` shape, which `new Date()` alone reads as Invalid Date.
  it("reads a day-first timestamp", () => {
    const date = parseMutasiDate("05-09-2026 14:30:00")
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(8)
    expect(date?.getDate()).toBe(5)
  })

  it("reads a day-first date with slashes and no time", () => {
    const date = parseMutasiDate("31/12/2026")
    expect(date?.getMonth()).toBe(11)
    expect(date?.getDate()).toBe(31)
  })

  it("returns nothing for a value it cannot read", () => {
    expect(parseMutasiDate(null)).toBeNull()
    expect(parseMutasiDate("")).toBeNull()
    expect(parseMutasiDate("-")).toBeNull()
  })
})

describe("isWithinLocalDateRange", () => {
  // `topup/history` ignores dates entirely, so the whole topup history comes back
  // and the range has to be applied here.
  it("keeps a topup inside the selected range", () => {
    expect(isWithinLocalDateRange("2026-09-05 08:00:00", "2026-09-01", "2026-09-07")).toBe(true)
  })

  it("includes both ends of the range", () => {
    expect(isWithinLocalDateRange("2026-09-01 00:05:00", "2026-09-01", "2026-09-07")).toBe(true)
    expect(isWithinLocalDateRange("2026-09-07 23:55:00", "2026-09-01", "2026-09-07")).toBe(true)
  })

  it("drops a topup from before the range", () => {
    expect(isWithinLocalDateRange("2026-08-30 10:00:00", "2026-09-01", "2026-09-07")).toBe(false)
  })

  it("drops a topup from after the range", () => {
    expect(isWithinLocalDateRange("2026-09-09 10:00:00", "2026-09-01", "2026-09-07")).toBe(false)
  })

  it("handles the day-first format the same way", () => {
    expect(isWithinLocalDateRange("05-09-2026 08:00:00", "2026-09-01", "2026-09-07")).toBe(true)
    expect(isWithinLocalDateRange("30-08-2026 08:00:00", "2026-09-01", "2026-09-07")).toBe(false)
  })

  it("reports an unreadable timestamp as outside the range", () => {
    expect(isWithinLocalDateRange(null, "2026-09-01", "2026-09-07")).toBe(false)
  })
})

describe("normalizeStatus", () => {
  it("maps the vendor's status vocabulary", () => {
    expect(normalizeStatus("SUKSES")).toBe("sukses")
    expect(normalizeStatus("failed")).toBe("gagal")
    expect(normalizeStatus("pending")).toBe("proses")
    expect(normalizeStatus(null)).toBe("unknown")
  })
})

/** Only the fields the pricing helpers read; the rest of a row is noise here. */
function row(fields: Partial<HistoryPaymentItem>): HistoryPaymentItem {
  return {
    trxId: "1",
    inquiryId: null,
    productName: "-",
    description: null,
    serialNumber: null,
    total: null,
    amount: null,
    adminFee: null,
    status: "SUKSES",
    createdAt: null,
    vendorPrice: null,
    basePrice: null,
    sellPrice: null,
    profit: null,
    margin: null,
    denom: null,
    provider: null,
    merchant: null,
    plu: null,
    serviceType: null,
    customerNo: null,
    tokenNumber: null,
    paymentCode: null,
    receiptText: null,
    invoiceUrl: null,
    igrDesc: null,
    noRef: null,
    ...fields,
  }
}

describe("getProviderTotal", () => {
  // The live shape: `total` null, `amount` already carries the admin fee.
  it("reads amount as the total the outlet paid", () => {
    expect(getProviderTotal(row({ amount: 73229, basePrice: 69729, adminFee: 3500 }))).toBe(73229)
  })

  it("falls back to total, then to the bill plus the admin fee", () => {
    expect(getProviderTotal(row({ total: 23500 }))).toBe(23500)
    expect(getProviderTotal(row({ basePrice: 20000, adminFee: 3500 }))).toBe(23500)
    expect(getProviderTotal(row({ basePrice: 20000 }))).toBe(20000)
    expect(getProviderTotal(row({}))).toBeNull()
  })
})

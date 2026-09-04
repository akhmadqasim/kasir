import { describe, expect, it } from "vitest"
import {
  EMPTY_AMOUNT_ENTRY_TIMING,
  MAX_PAYMENT_AMOUNT,
  isImplausiblePaymentAmount,
  isScannerBurstEntry,
  trackAmountEntry,
} from "./payment-behavior"

describe("isScannerBurstEntry", () => {
  it("detects a barcode burst followed by an instant Enter", () => {
    expect(
      isScannerBurstEntry({
        amount: "8991002103011",
        startedAt: 1000,
        lastInputAt: 1090,
        submittedAt: 1100,
      })
    ).toBe(true)
  })

  it("keeps a human-typed amount even when the value is long", () => {
    expect(
      isScannerBurstEntry({
        amount: "1000000",
        startedAt: 1000,
        lastInputAt: 2400,
        submittedAt: 2600,
      })
    ).toBe(false)
  })

  it("keeps an Enter pressed well after the input settled", () => {
    expect(
      isScannerBurstEntry({
        amount: "8991002103011",
        startedAt: 1000,
        lastInputAt: 1090,
        submittedAt: 1900,
      })
    ).toBe(false)
  })

  it("keeps a short amount typed in a burst", () => {
    expect(
      isScannerBurstEntry({
        amount: "50000",
        startedAt: 1000,
        lastInputAt: 1080,
        submittedAt: 1100,
      })
    ).toBe(false)
  })

  it("keeps an amount that did not come from the keyboard", () => {
    expect(
      isScannerBurstEntry({
        amount: "8991002103011",
        startedAt: 0,
        lastInputAt: 0,
        submittedAt: 1100,
      })
    ).toBe(false)
  })

  it("keeps an empty amount", () => {
    expect(
      isScannerBurstEntry({
        amount: "",
        startedAt: 1000,
        lastInputAt: 1090,
        submittedAt: 1100,
      })
    ).toBe(false)
  })
})

describe("isImplausiblePaymentAmount", () => {
  it("rejects an EAN-13 barcode that landed in the amount field", () => {
    expect(isImplausiblePaymentAmount(8991002103011)).toBe(true)
  })

  it("accepts a large but realistic cash payment", () => {
    expect(isImplausiblePaymentAmount(5_000_000)).toBe(false)
  })

  it("accepts the maximum allowed payment", () => {
    expect(isImplausiblePaymentAmount(MAX_PAYMENT_AMOUNT)).toBe(false)
  })

  it("rejects anything above the maximum allowed payment", () => {
    expect(isImplausiblePaymentAmount(MAX_PAYMENT_AMOUNT + 1)).toBe(true)
  })

  it("accepts zero and empty input", () => {
    expect(isImplausiblePaymentAmount(0)).toBe(false)
  })
})

describe("trackAmountEntry", () => {
  it("starts a burst on the first keystroke", () => {
    expect(trackAmountEntry(EMPTY_AMOUNT_ENTRY_TIMING, 1000)).toEqual({
      startedAt: 1000,
      lastInputAt: 1000,
    })
  })

  it("keeps the burst start while keystrokes keep coming", () => {
    const first = trackAmountEntry(EMPTY_AMOUNT_ENTRY_TIMING, 1000)
    const second = trackAmountEntry(first, 1010)
    const third = trackAmountEntry(second, 1020)

    expect(third).toEqual({ startedAt: 1000, lastInputAt: 1020 })
  })

  it("restarts the burst after the cashier pauses", () => {
    const first = trackAmountEntry(EMPTY_AMOUNT_ENTRY_TIMING, 1000)
    const second = trackAmountEntry(first, 1600)

    expect(second).toEqual({ startedAt: 1600, lastInputAt: 1600 })
  })

  it("flags a full scanner burst but not slow typing", () => {
    let scannerTiming = EMPTY_AMOUNT_ENTRY_TIMING
    for (let i = 0; i < 13; i += 1) {
      scannerTiming = trackAmountEntry(scannerTiming, 1000 + i * 8)
    }
    expect(
      isScannerBurstEntry({
        amount: "8991002103011",
        ...scannerTiming,
        submittedAt: scannerTiming.lastInputAt + 10,
      })
    ).toBe(true)

    let typedTiming = EMPTY_AMOUNT_ENTRY_TIMING
    for (let i = 0; i < 6; i += 1) {
      typedTiming = trackAmountEntry(typedTiming, 1000 + i * 180)
    }
    expect(
      isScannerBurstEntry({
        amount: "100000",
        ...typedTiming,
        submittedAt: typedTiming.lastInputAt + 200,
      })
    ).toBe(false)
  })
})

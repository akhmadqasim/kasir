import { describe, expect, it } from "vitest"
import { EMPTY_SCANNER_BURST, isScannerBurst, trackScannerBurst } from "@/lib/scanner-burst"
import { MAX_PAYMENT_AMOUNT, isImplausiblePaymentAmount } from "./payment-behavior"

describe("isScannerBurst", () => {
  it("detects a barcode burst followed by an instant Enter", () => {
    expect(
      isScannerBurst({ digits: "8991002103011", startedAt: 1000, lastInputAt: 1090 }, 1100),
    ).toBe(true)
  })

  it("keeps a human-typed amount even when the value is long", () => {
    expect(isScannerBurst({ digits: "1000000", startedAt: 1000, lastInputAt: 2400 }, 2600)).toBe(
      false,
    )
  })

  it("keeps an Enter pressed well after the input settled", () => {
    expect(
      isScannerBurst({ digits: "8991002103011", startedAt: 1000, lastInputAt: 1090 }, 1900),
    ).toBe(false)
  })

  it("keeps a short amount typed in a burst", () => {
    expect(isScannerBurst({ digits: "50000", startedAt: 1000, lastInputAt: 1080 }, 1100)).toBe(
      false,
    )
  })

  it("keeps an amount that did not come from the keyboard", () => {
    expect(isScannerBurst({ digits: "8991002103011", startedAt: 0, lastInputAt: 0 }, 1100)).toBe(
      false,
    )
  })

  it("keeps an empty amount", () => {
    expect(isScannerBurst({ digits: "", startedAt: 1000, lastInputAt: 1090 }, 1100)).toBe(false)
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

describe("trackScannerBurst", () => {
  it("starts a burst on the first keystroke", () => {
    expect(trackScannerBurst(EMPTY_SCANNER_BURST, "", 1000)).toEqual({
      digits: "",
      startedAt: 1000,
      lastInputAt: 1000,
    })
  })

  it("keeps the burst start while keystrokes keep coming", () => {
    const first = trackScannerBurst(EMPTY_SCANNER_BURST, "", 1000)
    const second = trackScannerBurst(first, "", 1010)
    const third = trackScannerBurst(second, "", 1020)

    expect(third).toEqual({ digits: "", startedAt: 1000, lastInputAt: 1020 })
  })

  it("restarts the burst after the cashier pauses", () => {
    const first = trackScannerBurst(EMPTY_SCANNER_BURST, "", 1000)
    const second = trackScannerBurst(first, "", 1600)

    expect(second).toEqual({ digits: "", startedAt: 1600, lastInputAt: 1600 })
  })

  it("flags a full scanner burst but not slow typing", () => {
    let scannerTiming = EMPTY_SCANNER_BURST
    for (let i = 0; i < 13; i += 1) {
      scannerTiming = trackScannerBurst(scannerTiming, "", 1000 + i * 8)
    }
    expect(
      isScannerBurst({ ...scannerTiming, digits: "8991002103011" }, scannerTiming.lastInputAt + 10),
    ).toBe(true)

    let typedTiming = EMPTY_SCANNER_BURST
    for (let i = 0; i < 6; i += 1) {
      typedTiming = trackScannerBurst(typedTiming, "", 1000 + i * 180)
    }
    expect(
      isScannerBurst({ ...typedTiming, digits: "100000" }, typedTiming.lastInputAt + 200),
    ).toBe(false)
  })
})

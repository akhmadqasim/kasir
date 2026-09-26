import { describe, expect, it } from "vitest"

import { resolveDefaultPaymentMethod } from "./components/payment/payment-methods"
import {
  createInitialPaymentSplits,
  remainingAmountFor,
  resolveActivePaymentMethod,
  summarizePayment,
  togglePaymentMethod,
  withSplit,
  type PaymentSplitForm,
} from "./components/payment/payment-splits"

function selectedMethods(splits: PaymentSplitForm[]): string[] {
  return splits.filter((split) => split.selected).map((split) => split.payment_method)
}

describe("resolveDefaultPaymentMethod", () => {
  it("keeps a method the dialog offers and falls back to cash otherwise", () => {
    expect(resolveDefaultPaymentMethod("qris")).toBe("qris")
    expect(resolveDefaultPaymentMethod("mixed")).toBe("cash")
    expect(resolveDefaultPaymentMethod(null)).toBe("cash")
  })
})

describe("createInitialPaymentSplits", () => {
  it("starts a non-cash default at the full total and cash empty", () => {
    const qris = createInitialPaymentSplits("qris", 6000)
    expect(selectedMethods(qris)).toEqual(["qris"])
    expect(qris.find((split) => split.payment_method === "qris")?.amount).toBe(6000)

    const cash = createInitialPaymentSplits("cash", 6000)
    expect(cash.find((split) => split.payment_method === "cash")?.amount).toBeNull()
  })
})

describe("togglePaymentMethod", () => {
  it("replaces a lone cash selection, then adds every further method", () => {
    const start = createInitialPaymentSplits("cash", 6000)

    const qris = togglePaymentMethod(start, "qris", 6000, "cash")
    expect(selectedMethods(qris.splits)).toEqual(["qris"])
    expect(qris.active).toBe("qris")

    const split = togglePaymentMethod(qris.splits, "cash", 6000, qris.active)
    expect(selectedMethods(split.splits)).toEqual(["cash", "qris"])
    expect(split.active).toBe("cash")
  })

  it("releases a selected method, but never the last one", () => {
    const both = withSplit(createInitialPaymentSplits("qris", 6000), "cash", { selected: true })

    const released = togglePaymentMethod(both, "cash", 6000, "cash")
    expect(selectedMethods(released.splits)).toEqual(["qris"])
    expect(released.active).toBe("qris")

    const kept = togglePaymentMethod(released.splits, "qris", 6000, "qris")
    expect(kept.splits).toBe(released.splits)
    expect(kept.active).toBe("qris")
  })
})

describe("resolveActivePaymentMethod", () => {
  it("falls back to the first selected method when the requested one is not selected", () => {
    const splits = createInitialPaymentSplits("qris", 6000)
    expect(resolveActivePaymentMethod(splits, "cash")).toBe("qris")
    expect(resolveActivePaymentMethod(splits, "qris")).toBe("qris")
  })
})

describe("remainingAmountFor", () => {
  it("is what the other selected methods leave of the total", () => {
    const splits = withSplit(createInitialPaymentSplits("qris", 4000), "cash", { selected: true })
    expect(remainingAmountFor(splits, "cash", 6000)).toBe(2000)
    expect(remainingAmountFor(splits, "cash", 3000)).toBe(0)
  })
})

describe("summarizePayment", () => {
  it("reports change for single cash and sends no breakdown", () => {
    const splits = withSplit(createInitialPaymentSplits("cash"), "cash", { amount: 10000 })
    const payment = summarizePayment(splits, 6000)

    expect(payment.isSingleCashSelection).toBe(true)
    expect(payment.changeAmount).toBe(4000)
    expect(payment.isValid).toBe(true)
    expect(payment.paymentBreakdown).toBeUndefined()
  })

  it("names what a cash split is still short of", () => {
    let splits = withSplit(createInitialPaymentSplits("qris", 2000), "cash", {
      selected: true,
      amount: 1000,
    })
    let payment = summarizePayment(splits, 6000)
    expect(payment.isValid).toBe(false)
    expect(payment.splitError).toMatch(/Nominal tunai masih kurang/)

    splits = withSplit(splits, "cash", { amount: 10000 })
    payment = summarizePayment(splits, 6000)
    expect(payment.isValid).toBe(true)
    expect(payment.splitCashChange).toBe(6000)
    expect(payment.paymentAmount).toBe(12000)
    expect(payment.paymentBreakdown?.map((split) => split.payment_method)).toEqual(["cash", "qris"])
  })

  it("refuses an amount no sembako sale reaches — a barcode in the field", () => {
    const splits = withSplit(createInitialPaymentSplits("cash"), "cash", {
      amount: 8_991_234_567_890,
    })
    const payment = summarizePayment(splits, 6000)
    expect(payment.hasImplausibleAmount).toBe(true)
    expect(payment.isValid).toBe(false)
  })
})

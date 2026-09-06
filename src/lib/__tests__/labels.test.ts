import { describe, expect, it } from "vitest"
import {
  PAYMENT_METHOD_LABELS,
  SELECTABLE_PAYMENT_METHODS,
  TRANSACTION_STATUS_LABELS,
  isSelectablePaymentMethod,
  paymentMethodLabel,
  paymentSplitLabel,
  transactionStatusLabel,
} from "../labels"

/** Nilai yang diterima `transactions.payment_method` sejak migrasi 014. */
const PAYMENT_METHODS = ["cash", "qris", "debit", "ewallet", "transfer", "mixed"]

/** Nilai yang bisa ditulis backend ke `transactions.status`. */
const TRANSACTION_STATUSES = [
  "completed",
  "pending_ppob",
  "ppob_failed",
  "refunded",
  "partial_refund",
  "deleted",
]

describe("payment method labels", () => {
  it("labels every valid method", () => {
    for (const method of PAYMENT_METHODS) {
      expect(PAYMENT_METHOD_LABELS[method]).toBeTruthy()
      expect(paymentMethodLabel(method)).not.toBe(method)
    }
  })

  it("covers exactly the valid methods", () => {
    expect(Object.keys(PAYMENT_METHOD_LABELS).sort()).toEqual([...PAYMENT_METHODS].sort())
  })

  it("shows an unknown method as-is rather than blank", () => {
    expect(paymentMethodLabel("kredit")).toBe("kredit")
  })
})

describe("selectable payment methods", () => {
  // Must equal `VALID_PAYMENT_METHODS` in commands/transactions.rs.
  it("matches what update_payment_method accepts", () => {
    expect([...SELECTABLE_PAYMENT_METHODS]).toEqual([
      "cash",
      "qris",
      "debit",
      "ewallet",
      "transfer",
    ])
  })

  // `mixed` is derived from several transaction_payments rows, not a method an
  // admin can save; the backend answers "Metode pembayaran tidak valid: mixed".
  it("rejects mixed and anything else the backend would refuse", () => {
    expect(isSelectablePaymentMethod("mixed")).toBe(false)
    expect(isSelectablePaymentMethod("")).toBe(false)
    expect(isSelectablePaymentMethod(null)).toBe(false)
    expect(isSelectablePaymentMethod(undefined)).toBe(false)
    expect(isSelectablePaymentMethod("kredit")).toBe(false)
  })

  it("still labels mixed for display", () => {
    expect(paymentMethodLabel("mixed")).toBe("Campuran")
  })

  it("accepts every method the picker offers", () => {
    for (const method of SELECTABLE_PAYMENT_METHODS) {
      expect(isSelectablePaymentMethod(method)).toBe(true)
    }
  })
})

describe("paymentSplitLabel", () => {
  it("appends the bank name when there is one", () => {
    expect(paymentSplitLabel("transfer", "BCA")).toBe("Transfer Bank (BCA)")
  })

  it("ignores a blank bank name", () => {
    expect(paymentSplitLabel("transfer", "   ")).toBe("Transfer Bank")
    expect(paymentSplitLabel("transfer", null)).toBe("Transfer Bank")
    expect(paymentSplitLabel("transfer")).toBe("Transfer Bank")
  })
})

describe("transaction status labels", () => {
  it("labels every status the backend can write", () => {
    for (const status of TRANSACTION_STATUSES) {
      expect(TRANSACTION_STATUS_LABELS[status]).toBeTruthy()
      expect(transactionStatusLabel(status)).not.toBe(status)
    }
  })

  it("shows an unknown status as-is rather than blank", () => {
    expect(transactionStatusLabel("archived")).toBe("archived")
  })
})

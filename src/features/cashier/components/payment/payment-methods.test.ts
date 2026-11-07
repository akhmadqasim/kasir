import { describe, expect, it } from "vitest"

import {
  PAYMENT_METHODS,
  PPOB_PIN_FIELD_NAME,
  findMethodByShortcut,
  isPinField,
  isTypingTarget,
  resolveDefaultPaymentMethod,
} from "./payment-methods"

describe("PAYMENT_METHODS", () => {
  it("gives every method a unique shortcut letter and a label", () => {
    const shortcuts = PAYMENT_METHODS.map((m) => m.shortcut)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
    for (const method of PAYMENT_METHODS) expect(method.label).toBeTruthy()
  })
})

describe("resolveDefaultPaymentMethod", () => {
  it("falls back to cash for unset or unknown values", () => {
    expect(resolveDefaultPaymentMethod(null)).toBe("cash")
    expect(resolveDefaultPaymentMethod(undefined)).toBe("cash")
    expect(resolveDefaultPaymentMethod("bitcoin")).toBe("cash")
  })

  it("keeps a selectable configured method", () => {
    expect(resolveDefaultPaymentMethod("qris")).toBe("qris")
  })
})

describe("findMethodByShortcut", () => {
  it("matches case-insensitively", () => {
    expect(findMethodByShortcut("a")?.value).toBe("cash")
    expect(findMethodByShortcut("Q")?.value).toBe("qris")
  })

  it("returns undefined for unbound keys", () => {
    expect(findMethodByShortcut("x")).toBeUndefined()
  })
})

describe("isTypingTarget / isPinField", () => {
  it("treats text inputs as typing targets but not numeric ones", () => {
    const text = document.createElement("input")
    const numeric = document.createElement("input")
    numeric.setAttribute("inputmode", "numeric")
    expect(isTypingTarget(text)).toBe(true)
    expect(isTypingTarget(numeric)).toBe(false)
  })

  it("treats the PIN field as typing even though it is numeric", () => {
    const pin = document.createElement("input")
    pin.name = PPOB_PIN_FIELD_NAME
    pin.setAttribute("inputmode", "numeric")
    expect(isPinField(pin)).toBe(true)
    expect(isTypingTarget(pin)).toBe(true)
  })

  it("rejects null targets", () => {
    expect(isPinField(null)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

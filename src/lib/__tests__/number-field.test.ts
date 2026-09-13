import { describe, expect, it } from "vitest"

import { isEmptyNumberFieldValue } from "../number-field"

describe("isEmptyNumberFieldValue", () => {
  it("is true while the field is cleared (undefined)", () => {
    expect(isEmptyNumberFieldValue(undefined)).toBe(true)
  })

  it("is true for an unparseable partial value (NaN)", () => {
    expect(isEmptyNumberFieldValue(Number.NaN)).toBe(true)
  })

  it("is false for any committed number, including zero and negatives", () => {
    expect(isEmptyNumberFieldValue(0)).toBe(false)
    expect(isEmptyNumberFieldValue(-5)).toBe(false)
    expect(isEmptyNumberFieldValue(100)).toBe(false)
  })
})

import { describe, expect, it } from "vitest"
import { normalizePhoneNumber, toChatId } from "./phone-number"

describe("normalizePhoneNumber", () => {
  it("turns a leading 0 into the 62 country code", () => {
    expect(normalizePhoneNumber("081234567890")).toBe("6281234567890")
  })

  it("prefixes a bare mobile number with 62", () => {
    expect(normalizePhoneNumber("81234567890")).toBe("6281234567890")
  })

  it("keeps a number already carrying the country code", () => {
    expect(normalizePhoneNumber("6281234567890")).toBe("6281234567890")
  })

  it("strips a leading + before the country code", () => {
    expect(normalizePhoneNumber("+6281234567890")).toBe("6281234567890")
  })

  it("ignores spaces and dashes anywhere in the number", () => {
    expect(normalizePhoneNumber("0812-3456-7890")).toBe("6281234567890")
    expect(normalizePhoneNumber("+62 812 3456 7890")).toBe("6281234567890")
  })

  it("rejects an empty or non-numeric string", () => {
    expect(normalizePhoneNumber("")).toBeNull()
    expect(normalizePhoneNumber("abc")).toBeNull()
  })

  it("rejects a number too short to be a real mobile number", () => {
    expect(normalizePhoneNumber("0812345")).toBeNull()
  })

  it("rejects a number too long to be a real mobile number", () => {
    expect(normalizePhoneNumber("081234567890123456")).toBeNull()
  })

  it("rejects a landline-shaped number (no leading 8 after the country code)", () => {
    expect(normalizePhoneNumber("62215551234")).toBeNull()
  })

  it("rejects a prefix that is neither 0, 8 nor 62", () => {
    expect(normalizePhoneNumber("1234567890")).toBeNull()
  })
})

describe("toChatId", () => {
  it("appends the WhatsApp user suffix", () => {
    expect(toChatId("6281234567890")).toBe("6281234567890@c.us")
  })
})

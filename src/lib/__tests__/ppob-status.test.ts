import { describe, expect, it } from "vitest"
import {
  PPOB_STATUS_CONFIG,
  isPpobInFlight,
  isPpobRetryable,
  isPpobUncertain,
  ppobStatusConfig,
} from "../ppob-status"

describe("ppobStatusConfig", () => {
  it("covers every state the backend can write", () => {
    expect(Object.keys(PPOB_STATUS_CONFIG).sort()).toEqual([
      "failed",
      "pending",
      "processing",
      "success",
      "uncertain",
    ])
  })

  it("labels the retry state a cashier now sees", () => {
    expect(ppobStatusConfig("processing")?.label).toBe("Sedang Diproses")
  })

  // Warna badge dipilih `StatusBadge`, jadi di sini hanya artinya yang dijaga.
  it("names the meaning of each state instead of a colour class", () => {
    expect(ppobStatusConfig("pending")?.variant).toBe("warning")
    expect(ppobStatusConfig("processing")?.variant).toBe("info")
    expect(ppobStatusConfig("success")?.variant).toBe("success")
    expect(ppobStatusConfig("failed")?.variant).toBe("error")
    expect(ppobStatusConfig("uncertain")?.variant).toBe("warning")
  })

  it("returns nothing for a line that is not PPOB", () => {
    expect(ppobStatusConfig(null)).toBeNull()
    expect(ppobStatusConfig(undefined)).toBeNull()
    expect(ppobStatusConfig("unknown")).toBeNull()
  })

  it("ignores names inherited from Object.prototype", () => {
    expect(ppobStatusConfig("toString")).toBeNull()
    expect(ppobStatusConfig("constructor")).toBeNull()
    expect(isPpobInFlight("toString")).toBe(false)
  })
})

describe("isPpobRetryable", () => {
  // `claim_ppob_retry` only moves a row out of `failed`; offering `pending` or
  // `processing` just produces "Fulfillment PPOB masih diproses".
  it("offers a retry only for a failed line", () => {
    expect(isPpobRetryable("failed")).toBe(true)
    expect(isPpobRetryable("pending")).toBe(false)
    expect(isPpobRetryable("processing")).toBe(false)
    expect(isPpobRetryable("success")).toBe(false)
    expect(isPpobRetryable(null)).toBe(false)
  })
})

describe("isPpobInFlight", () => {
  it("spins while a provider call has not reported back", () => {
    expect(isPpobInFlight("pending")).toBe(true)
    expect(isPpobInFlight("processing")).toBe(true)
    expect(isPpobInFlight("success")).toBe(false)
    expect(isPpobInFlight("failed")).toBe(false)
    expect(isPpobInFlight(null)).toBe(false)
  })
})

describe("isPpobUncertain", () => {
  // An unanswered call may have spent the money: never offered as a retry.
  it("is its own state, not a retryable failure", () => {
    expect(isPpobUncertain("uncertain")).toBe(true)
    expect(isPpobRetryable("uncertain")).toBe(false)
    expect(isPpobInFlight("uncertain")).toBe(false)
    expect(isPpobUncertain("failed")).toBe(false)
  })
})

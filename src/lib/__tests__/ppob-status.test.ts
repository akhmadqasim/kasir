import { describe, expect, it } from "vitest"
import {
  PPOB_IN_FLIGHT_POLL_MS,
  PPOB_STATUS_CONFIG,
  hasPpobLineInFlight,
  isPpobAwaitingBiller,
  isPpobInFlight,
  isPpobRetryable,
  isPpobUncertain,
  ppobLineStatusConfig,
  ppobLines,
  ppobRowBadge,
  ppobSalePollInterval,
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

describe("ADVICE (menunggu konfirmasi biller)", () => {
  const advice = { ppob_status: "uncertain", ppob_advice: "{}", service_type: "pln" }

  it("is an uncertain line with Mitra's ADVICE reference kept", () => {
    expect(isPpobAwaitingBiller(advice)).toBe(true)
    expect(isPpobAwaitingBiller({ ...advice, ppob_advice: null })).toBe(false)
    expect(isPpobAwaitingBiller({ ...advice, ppob_advice: undefined })).toBe(false)
    // Settled lines keep the reference, but no longer wait.
    expect(isPpobAwaitingBiller({ ...advice, ppob_status: "success" })).toBe(false)
    expect(isPpobAwaitingBiller({ ...advice, ppob_status: "failed" })).toBe(false)
  })

  it("reads as waiting on PLN, never as failed", () => {
    expect(ppobLineStatusConfig(advice)).toEqual({
      label: "Menunggu Konfirmasi PLN",
      variant: "warning",
      inFlight: false,
    })
    expect(ppobLineStatusConfig({ ...advice, service_type: "pdam" })?.label).toBe(
      "Menunggu Konfirmasi",
    )
    expect(ppobLineStatusConfig({ ...advice, ppob_advice: null })?.label).toBe("Perlu Dicek")
    expect(ppobLineStatusConfig({ ppob_status: "failed" })?.label).toBe("Gagal")
  })

  it("is neither retryable nor in flight", () => {
    expect(isPpobRetryable(advice.ppob_status)).toBe(false)
    expect(isPpobInFlight(advice.ppob_status)).toBe(false)
  })
})

describe("ppobRowBadge", () => {
  const row = (ppob_status: string | null, extra: object = {}) => ({
    has_ppob: true,
    ppob_status,
    ppob_advice: null,
    service_type: "pulsa",
    ...extra,
  })

  it("marks only the exceptions, and names them as PPOB", () => {
    expect(ppobRowBadge(row("success"))).toBeNull()
    expect(ppobRowBadge({ ...row("failed"), has_ppob: false })).toBeNull()
    expect(ppobRowBadge(row("failed"))).toEqual({ label: "PPOB gagal", variant: "error" })
    expect(ppobRowBadge(row("uncertain"))).toEqual({
      label: "PPOB perlu dicek",
      variant: "warning",
    })
    expect(ppobRowBadge(row("pending"))?.label).toBe("PPOB menunggu")
  })

  it("reads an ADVICE line as waiting on PLN", () => {
    expect(ppobRowBadge(row("uncertain", { ppob_advice: "{}", service_type: "pln" }))).toEqual({
      label: "Menunggu Konfirmasi PLN",
      variant: "warning",
    })
  })
})

describe("sale polling", () => {
  it("polls only while a line is pending or processing", () => {
    const line = (ppob_status: string | null) => ({ ppob_status })
    expect(ppobSalePollInterval([])).toBe(false)
    expect(ppobSalePollInterval([line("success"), line("pending")])).toBe(PPOB_IN_FLIGHT_POLL_MS)
    expect(ppobSalePollInterval([line(null)])).toBe(PPOB_IN_FLIGHT_POLL_MS)
    expect(ppobSalePollInterval([line("success"), line("uncertain")])).toBe(false)
    expect(ppobSalePollInterval([line("success"), line("failed")])).toBe(false)
    expect(hasPpobLineInFlight([line("processing")])).toBe(true)
    expect(ppobLines([{ service_type: "pln" }, { service_type: null }])).toHaveLength(1)
  })
})

import { describe, expect, it } from "vitest"
import {
  WRITEOFF_REASON_OPTIONS,
  WRITEOFF_STATUS_OPTIONS,
  writeoffReasonLabel,
  writeoffStatusLabel,
  writeoffStatusVariant,
} from "./labels"

describe("writeoffReasonLabel", () => {
  it("labels every reason the backend accepts", () => {
    expect(writeoffReasonLabel("damaged")).toBe("Rusak")
    expect(writeoffReasonLabel("expired")).toBe("Kadaluarsa")
    expect(writeoffReasonLabel("lost")).toBe("Hilang")
    expect(writeoffReasonLabel("other")).toBe("Lainnya")
  })

  it("falls back to the raw value for an unknown reason", () => {
    expect(writeoffReasonLabel("stolen")).toBe("stolen")
    expect(writeoffReasonLabel("")).toBe("")
  })

  it("offers exactly the four schema reasons", () => {
    expect(WRITEOFF_REASON_OPTIONS.map((o) => o.key)).toEqual([
      "damaged",
      "expired",
      "lost",
      "other",
    ])
  })
})

describe("writeoffStatusLabel", () => {
  it("labels every status", () => {
    expect(writeoffStatusLabel("pending")).toBe("Menunggu")
    expect(writeoffStatusLabel("approved")).toBe("Disetujui")
    expect(writeoffStatusLabel("rejected")).toBe("Ditolak")
  })

  it("falls back to the raw value for an unknown status", () => {
    expect(writeoffStatusLabel("archived")).toBe("archived")
  })

  it("offers exactly the three schema statuses", () => {
    expect(WRITEOFF_STATUS_OPTIONS.map((o) => o.key)).toEqual([
      "pending",
      "approved",
      "rejected",
    ])
  })
})

describe("writeoffStatusVariant", () => {
  it("maps statuses to badge variants", () => {
    expect(writeoffStatusVariant("pending")).toBe("warning")
    expect(writeoffStatusVariant("approved")).toBe("success")
    expect(writeoffStatusVariant("rejected")).toBe("error")
  })

  it("uses neutral for unknown statuses", () => {
    expect(writeoffStatusVariant("archived")).toBe("neutral")
    expect(writeoffStatusVariant("")).toBe("neutral")
  })
})

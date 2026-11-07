import { describe, expect, it } from "vitest"

import { id as t } from "@/i18n/id"
import type { UpdateStatus } from "../types"
import { describeStatus, isVisibleFailure } from "./describe-status"

const base = { current_version: "1.0.0" }

describe("describeStatus", () => {
  it("describes simple phases", () => {
    expect(describeStatus({ ...base, phase: "idle" })).toBe(t.updater.notChecked)
    expect(describeStatus({ ...base, phase: "checking" })).toBe(t.updater.checking)
    expect(describeStatus({ ...base, phase: "up_to_date" })).toBe(t.updater.upToDate)
  })

  it("includes the version for versioned phases", () => {
    const available: UpdateStatus = { ...base, phase: "available", version: "2.0.0", notes: null, published_at: null }
    expect(describeStatus(available)).toBe(t.updater.available("2.0.0"))
    expect(describeStatus({ ...base, phase: "downloading", version: "2.0.0", received: 1, total: null })).toBe(
      t.updater.downloading("2.0.0"),
    )
    expect(describeStatus({ ...base, phase: "ready", version: "2.0.0" })).toBe(t.updater.ready("2.0.0"))
    expect(describeStatus({ ...base, phase: "installing", version: "2.0.0" })).toBe(t.updater.installing("2.0.0"))
  })

  it("returns the failure message verbatim", () => {
    expect(describeStatus({ ...base, phase: "failed", step: "download", message: "boom" })).toBe("boom")
  })
})

describe("isVisibleFailure", () => {
  it("hides failed checks and non-failures", () => {
    expect(isVisibleFailure(undefined)).toBe(false)
    expect(isVisibleFailure({ ...base, phase: "idle" })).toBe(false)
    expect(isVisibleFailure({ ...base, phase: "failed", step: "check", message: "x" })).toBe(false)
  })

  it("shows failed download and install", () => {
    expect(isVisibleFailure({ ...base, phase: "failed", step: "download", message: "x" })).toBe(true)
    expect(isVisibleFailure({ ...base, phase: "failed", step: "install", message: "x" })).toBe(true)
  })
})

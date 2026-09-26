import { describe, expect, it } from "vitest"
import { isRefundCondition, refundConditionBadge } from "./labels"

describe("refundConditionBadge", () => {
  it("labels every condition the backend stores", () => {
    expect(refundConditionBadge("good")?.variant).toBe("success")
    expect(refundConditionBadge("damaged")?.variant).toBe("error")
    expect(refundConditionBadge("expired")?.variant).toBe("warning")
  })

  it("returns nothing for a missing or unknown condition", () => {
    expect(refundConditionBadge(null)).toBeNull()
    expect(refundConditionBadge("")).toBeNull()
    expect(refundConditionBadge("lost")).toBeNull()
  })

  it("ignores names inherited from Object.prototype", () => {
    expect(refundConditionBadge("toString")).toBeNull()
    expect(isRefundCondition("constructor")).toBe(false)
  })
})

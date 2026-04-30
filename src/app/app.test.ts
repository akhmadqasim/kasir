import { describe, expect, it } from "vitest"
import {
  getDefaultRouteForRole,
  isResumableRoute,
  isRouteAllowedForRole,
  resolveResumeRoute,
} from "./resume-route"

describe("resume-route", () => {
  it("uses role defaults when no stored route exists", () => {
    expect(getDefaultRouteForRole("kasir")).toBe("/cashier")
    expect(resolveResumeRoute("admin", null)).toBe("/dashboard")
  })

  it("accepts nested resumable routes", () => {
    expect(isResumableRoute("/reports/sales-daily")).toBe(true)
    expect(isResumableRoute("/ppob/history")).toBe(true)
  })

  it("rejects non-resumable routes", () => {
    expect(isResumableRoute("/")).toBe(false)
    expect(isResumableRoute("/start")).toBe(false)
    expect(isResumableRoute("/login")).toBe(false)
  })

  it("blocks admin-only routes for kasir users", () => {
    expect(isRouteAllowedForRole("/users", "kasir")).toBe(false)
    expect(resolveResumeRoute("kasir", "/users")).toBe("/cashier")
  })

  it("restores stored route when it matches the active role", () => {
    expect(resolveResumeRoute("admin", "/users")).toBe("/users")
    expect(resolveResumeRoute("kasir", "/transactions")).toBe("/transactions")
  })
})

import { describe, expect, it } from "vitest"
import {
  getDefaultRouteForRole,
  isAdminOnlyRoute,
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
    expect(isResumableRoute("/ppob/mutasi")).toBe(true)
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

describe("isAdminOnlyRoute", () => {
  it("covers every screen whose commands require the admin role", () => {
    expect(isAdminOnlyRoute("/users")).toBe(true)
    expect(isAdminOnlyRoute("/products")).toBe(true)
    expect(isAdminOnlyRoute("/settings")).toBe(true)
    expect(isAdminOnlyRoute("/ppob/settings")).toBe(true)
  })

  it("leaves the routes a cashier needs open", () => {
    expect(isAdminOnlyRoute("/cashier")).toBe(false)
    expect(isAdminOnlyRoute("/transactions")).toBe(false)
    expect(isAdminOnlyRoute("/refunds")).toBe(false)
    expect(isAdminOnlyRoute("/stock")).toBe(false)
    expect(isAdminOnlyRoute("/reports/sales-daily")).toBe(false)
    expect(isAdminOnlyRoute("/dashboard")).toBe(false)
    expect(isAdminOnlyRoute("/ppob")).toBe(false)
  })

  it("matches nested paths but not lookalike prefixes", () => {
    expect(isAdminOnlyRoute("/settings/backup")).toBe(true)
    expect(isAdminOnlyRoute("/products-report")).toBe(false)
  })

  it("handles trailing slashes and missing values", () => {
    expect(isAdminOnlyRoute("/products/")).toBe(true)
    expect(isAdminOnlyRoute(null)).toBe(false)
    expect(isAdminOnlyRoute("")).toBe(false)
  })

  it("keeps kasir out of the admin screens it used to reach", () => {
    expect(isRouteAllowedForRole("/products", "kasir")).toBe(false)
    expect(isRouteAllowedForRole("/settings", "kasir")).toBe(false)
    expect(isRouteAllowedForRole("/products", "admin")).toBe(true)
    expect(resolveResumeRoute("kasir", "/products")).toBe("/cashier")
  })
})

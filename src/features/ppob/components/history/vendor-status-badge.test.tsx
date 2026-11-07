import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { VendorStatusBadge } from "./vendor-status-badge"

describe("VendorStatusBadge", () => {
  it("shows Sukses for a success status", () => {
    render(<VendorStatusBadge status="SUKSES" />)
    expect(screen.getByText("Sukses")).toBeInTheDocument()
  })

  it("shows Gagal for a failed status", () => {
    render(<VendorStatusBadge status="gagal" />)
    expect(screen.getByText("Gagal")).toBeInTheDocument()
  })

  it("shows unknown status as-is", () => {
    render(<VendorStatusBadge status="ANEH" />)
    expect(screen.getByText("ANEH")).toBeInTheDocument()
  })

  it("shows a dash for null", () => {
    render(<VendorStatusBadge status={null} />)
    expect(screen.getByText("-")).toBeInTheDocument()
  })
})

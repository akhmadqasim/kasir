import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { CashFlowDescription } from "./cash-flow-description"

describe("CashFlowDescription", () => {
  it("renders the description as a plain span with no tab stop or button role", () => {
    render(<CashFlowDescription description="Beli galon air" />)
    const span = screen.getByText("Beli galon air")
    expect(span.tagName).toBe("SPAN")
    expect(span).not.toHaveAttribute("role")
    expect(span).not.toHaveAttribute("tabindex")
    expect(span.className).toContain("truncate")
    expect(screen.queryByRole("button")).toBeNull()
  })
})

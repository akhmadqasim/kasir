import { describe, expect, it } from "vitest"
import { fireEvent, render } from "@testing-library/react"
import { PaymentPointIcon } from "./payment-point-icon"

describe("PaymentPointIcon", () => {
  it("renders the image when a path is given", () => {
    const { container } = render(<PaymentPointIcon pathIcon="/a.png" className="size-6" />)
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/a.png")
  })

  it("renders the fallback glyph when path is null", () => {
    const { container } = render(<PaymentPointIcon pathIcon={null} className="size-6" />)
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("svg")).not.toBeNull()
  })

  it("switches to the fallback when the image fails to load", () => {
    const { container } = render(<PaymentPointIcon pathIcon="/bad.png" className="size-6" />)
    fireEvent.error(container.querySelector("img")!)
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("text-muted")
  })
})

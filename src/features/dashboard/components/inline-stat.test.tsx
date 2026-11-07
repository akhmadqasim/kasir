import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { InlineStat } from "./inline-stat"

describe("InlineStat", () => {
  it("renders the value before the label", () => {
    const { container } = render(<InlineStat label="Transaksi" value="42" />)
    const text = container.textContent ?? ""
    expect(screen.getByText("42")).toBeTruthy()
    expect(screen.getByText("Transaksi")).toBeTruthy()
    expect(text.indexOf("42")).toBeLessThan(text.indexOf("Transaksi"))
  })

  it("accepts a ReactNode value", () => {
    render(<InlineStat label="Omzet" value={<span data-testid="node">x</span>} />)
    expect(screen.getByTestId("node")).toBeTruthy()
  })
})

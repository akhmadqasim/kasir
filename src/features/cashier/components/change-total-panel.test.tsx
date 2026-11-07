import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { formatRupiah } from "@/lib/format"
import { ChangeTotalPanel } from "./change-total-panel"

/** `formatRupiah` emits a non-breaking space that the default matcher collapses. */
const byAmount = (amount: number) => (_: string, el: Element | null) =>
  el?.tagName === "P" && el.textContent === formatRupiah(amount)

describe("ChangeTotalPanel", () => {
  it("shows the change and the total", () => {
    render(<ChangeTotalPanel changeAmount={4000} totalAmount={16000} />)
    expect(screen.getByText("Kembalian")).toBeTruthy()
    expect(screen.getByText(byAmount(4000))).toBeTruthy()
    expect(screen.getByText("Total")).toBeTruthy()
    expect(screen.getByText(byAmount(16000))).toBeTruthy()
  })

  it("reads a null change as Rp 0", () => {
    render(<ChangeTotalPanel changeAmount={null} totalAmount={5000} />)
    expect(screen.getByText(byAmount(0))).toBeTruthy()
  })
})

import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { id } from "@/i18n/id"
import { RefundActionToggle } from "./refund-action-toggle"

function option(name: string): HTMLElement {
  return screen.getByRole("radio", { name: new RegExp(name) })
}

describe("RefundActionToggle", () => {
  it("renders both actions with the current one selected", () => {
    render(<RefundActionToggle value="refund" onChange={() => {}} />)
    expect(option(id.refund.actionRefund)).toHaveAttribute("aria-checked", "true")
    expect(option(id.refund.actionExchange)).toHaveAttribute("aria-checked", "false")
  })

  it("reports the picked action", () => {
    const onChange = vi.fn()
    render(<RefundActionToggle value="refund" onChange={onChange} />)
    fireEvent.click(option(id.refund.actionExchange))
    expect(onChange).toHaveBeenCalledWith("exchange")
  })

  it("closes exchange and explains why when the window has passed", () => {
    const onChange = vi.fn()
    render(
      <RefundActionToggle
        value="refund"
        onChange={onChange}
        exchangeDisabledReason="Lewat 7 hari"
      />,
    )
    expect(screen.getByText("Lewat 7 hari")).toBeInTheDocument()
    expect(option(id.refund.actionExchange)).toBeDisabled()
    fireEvent.click(option(id.refund.actionExchange))
    expect(onChange).not.toHaveBeenCalled()
  })
})

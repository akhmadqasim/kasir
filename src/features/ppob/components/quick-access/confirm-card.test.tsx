import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { ConfirmCard } from "./confirm-card"

const originalScroll = Element.prototype.scrollIntoView

afterEach(() => {
  Element.prototype.scrollIntoView = originalScroll
})

describe("ConfirmCard", () => {
  it("renders title, items, totals and footer", () => {
    render(
      <ConfirmCard
        title="Konfirmasi Token PLN"
        items={[{ label: "ID Pelanggan", value: "12345" }]}
        totals={[{ label: "Total", value: "Rp 21.000" }]}
        footer={<button type="button">Bayar</button>}
      />,
    )
    expect(screen.getByText("Konfirmasi Token PLN")).toBeInTheDocument()
    expect(screen.getByText("ID Pelanggan")).toBeInTheDocument()
    expect(screen.getByText("12345")).toBeInTheDocument()
    expect(screen.getByText("Rp 21.000")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bayar" })).toBeInTheDocument()
  })

  it("scrolls into view only when asked", () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const { rerender } = render(
      <ConfirmCard title="A" items={[]} footer={null} />,
    )
    expect(scroll).not.toHaveBeenCalled()
    rerender(<ConfirmCard title="A" items={[]} footer={null} scrollIntoView />)
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "end" })
  })
})

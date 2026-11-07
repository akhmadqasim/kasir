import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { CartFooter } from "./cart-footer"

function setup(overrides: Partial<Parameters<typeof CartFooter>[0]> = {}) {
  const handlers = {
    onDiscount: vi.fn(),
    onHold: vi.fn(),
    onCashFlow: vi.fn(),
    onCloseShift: vi.fn(),
    onPay: vi.fn(),
  }
  render(
    <CartFooter
      hasItems
      hasShift
      subtotal={10000}
      total={10000}
      totalDiscount={0}
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

const button = (name: RegExp) => screen.getByRole("button", { name })

describe("CartFooter", () => {
  it("fires each action when the cart has items and a shift is open", () => {
    const h = setup()
    fireEvent.click(button(/Diskon/))
    fireEvent.click(button(/Simpan/))
    fireEvent.click(button(/Uang/))
    fireEvent.click(button(/Tutup/))
    fireEvent.click(button(/Bayar/))
    expect(h.onDiscount).toHaveBeenCalledTimes(1)
    expect(h.onHold).toHaveBeenCalledTimes(1)
    expect(h.onCashFlow).toHaveBeenCalledTimes(1)
    expect(h.onCloseShift).toHaveBeenCalledTimes(1)
    expect(h.onPay).toHaveBeenCalledTimes(1)
  })

  it("disables cart actions on an empty cart", () => {
    const h = setup({ hasItems: false })
    fireEvent.click(button(/Bayar/))
    fireEvent.click(button(/Diskon/))
    expect(h.onPay).not.toHaveBeenCalled()
    expect(h.onDiscount).not.toHaveBeenCalled()
  })

  it("hides shift actions without an open shift", () => {
    setup({ hasShift: false })
    expect(screen.queryByRole("button", { name: /Uang/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Tutup/ })).toBeNull()
  })

  it("blocks Bayar and shows the reason when payment is blocked", () => {
    const h = setup({ payBlockedReason: "Shift belum dibuka" })
    fireEvent.click(button(/Bayar/))
    expect(h.onPay).not.toHaveBeenCalled()
    expect(screen.getByText("Shift belum dibuka")).toBeTruthy()
  })

  it("shows subtotal and discount rows only when discounted", () => {
    setup({ totalDiscount: 2000, total: 8000 })
    expect(screen.getByText("Subtotal")).toBeTruthy()
    expect(screen.getAllByText(/Diskon/).length).toBeGreaterThan(1)
  })
})

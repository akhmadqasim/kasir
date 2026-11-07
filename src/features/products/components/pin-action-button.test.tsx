import { fireEvent, render, screen } from "@testing-library/react"

import { describe, expect, it, vi } from "vitest"

import { PinActionButton } from "./pin-action-button"

describe("PinActionButton", () => {
  it("exposes toggle state and calls onPress", () => {
    const onPress = vi.fn()
    render(<PinActionButton isPinned={true} productName="Beras" onPress={onPress} />)
    const button = screen.getByRole("button", { name: "Pin Beras ke shortcut kasir" })
    expect(button).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(button)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("is not pressed when unpinned", () => {
    render(<PinActionButton isPinned={false} productName="Gula" onPress={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Pin Gula ke shortcut kasir" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
  })
})

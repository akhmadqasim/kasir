import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { IconActionButton } from "./icon-action-button"

describe("IconActionButton", () => {
  it("exposes the label as accessible name and calls onPress", () => {
    const onPress = vi.fn()
    render(<IconActionButton icon={<span data-testid="ico" />} label="Muat ulang" onPress={onPress} />)
    const button = screen.getByRole("button", { name: "Muat ulang" })
    expect(screen.getByTestId("ico")).toBeTruthy()
    fireEvent.click(button)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("hides the icon and ignores presses while pending", () => {
    const onPress = vi.fn()
    render(
      <IconActionButton isPending icon={<span data-testid="ico" />} label="Muat ulang" onPress={onPress} />,
    )
    expect(screen.queryByTestId("ico")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang" }))
    expect(onPress).not.toHaveBeenCalled()
  })
})

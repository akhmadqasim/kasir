import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { TileButton } from "./tile-button"

describe("TileButton", () => {
  it("renders label and description", () => {
    render(<TileButton label="Pulsa" description="Semua operator" />)
    expect(screen.getByRole("button", { name: /Pulsa/ })).toBeInTheDocument()
    expect(screen.getByText("Semua operator")).toBeInTheDocument()
  })

  it("renders a badge slot", () => {
    render(<TileButton label="Listrik" badge={<span>Gangguan</span>} />)
    expect(screen.getByText("Gangguan")).toBeInTheDocument()
  })

  it("wraps a tinted icon in an aria-hidden disc", () => {
    render(<TileButton label="PLN" icon={<svg data-testid="ico" />} iconTint="bg-red-100" />)
    const disc = screen.getByTestId("ico").parentElement
    expect(disc).toHaveAttribute("aria-hidden", "true")
    expect(disc?.className).toContain("bg-red-100")
  })

  it("calls onPress when clicked", () => {
    const onPress = vi.fn()
    render(<TileButton label="Pulsa" onPress={onPress} />)
    fireEvent.click(screen.getByRole("button", { name: /Pulsa/ }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("is disabled when isDisabled", () => {
    render(<TileButton label="Pulsa" isDisabled />)
    expect(screen.getByRole("button", { name: /Pulsa/ })).toBeDisabled()
  })
})

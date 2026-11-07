import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { TileGrid, TileGridSkeleton } from "./tile-grid"

describe("TileGrid", () => {
  it("renders children in a grid", () => {
    const { container } = render(
      <TileGrid>
        <span>A</span>
        <span>B</span>
      </TileGrid>,
    )
    expect(screen.getByText("A")).toBeInTheDocument()
    expect(container.firstElementChild?.className).toContain("gap-3")
  })

  it("uses tighter spacing when compact", () => {
    const { container } = render(
      <TileGrid compact>
        <span>A</span>
      </TileGrid>,
    )
    expect(container.firstElementChild?.className).toContain("gap-2")
  })

  it("renders the requested number of skeleton tiles", () => {
    const { container } = render(<TileGridSkeleton count={4} />)
    expect(container.firstElementChild?.children).toHaveLength(4)
  })
})

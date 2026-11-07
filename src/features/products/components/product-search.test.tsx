import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("../hooks/use-categories", () => ({
  useCategories: () => ({ data: [{ id: 1, name: "Beras" }] }),
}))

import { ProductSearch } from "./product-search"

function renderSearch(total?: number) {
  const props = {
    total,
    onSearchChange: vi.fn(),
    onCategoryChange: vi.fn(),
    quickFilter: "all" as const,
    onQuickFilterChange: vi.fn(),
  }
  render(<ProductSearch {...props} />)
  return props
}

describe("ProductSearch", () => {
  it("shows the result count when total is known", () => {
    renderSearch(12)
    expect(screen.getByText("12 produk")).toBeInTheDocument()
  })

  it("hides the count while loading", () => {
    renderSearch(undefined)
    expect(screen.queryByText(/produk$/)).not.toBeInTheDocument()
  })

  it("marks the active quick filter and reports a new one", () => {
    const { onQuickFilterChange } = renderSearch(0)
    expect(screen.getByRole("button", { name: "Semua" })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(screen.getByRole("button", { name: "Stok Rendah" }))
    expect(onQuickFilterChange).toHaveBeenCalledWith("low_stock")
  })
})

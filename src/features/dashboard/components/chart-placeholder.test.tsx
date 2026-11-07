import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { ChartPlaceholder } from "./chart-placeholder"

const base = { onRetry: vi.fn(), emptyIcon: <span />, emptyTitle: "Belum ada penjualan" }

describe("ChartPlaceholder", () => {
  it("shows neither the empty nor the error state while loading", () => {
    render(<ChartPlaceholder {...base} error={null} isLoading />)
    expect(screen.queryByText("Belum ada penjualan")).toBeNull()
  })

  it("shows the empty state with its description", () => {
    render(
      <ChartPlaceholder {...base} emptyDescription="Coba rentang lain" error={null} isLoading={false} />,
    )
    expect(screen.getByText("Belum ada penjualan")).toBeTruthy()
    expect(screen.getByText("Coba rentang lain")).toBeTruthy()
  })

  it("shows the error message instead of the empty state", () => {
    render(<ChartPlaceholder {...base} error={new Error("server mati")} isLoading={false} />)
    expect(screen.getByText("server mati")).toBeTruthy()
    expect(screen.queryByText("Belum ada penjualan")).toBeNull()
  })
})

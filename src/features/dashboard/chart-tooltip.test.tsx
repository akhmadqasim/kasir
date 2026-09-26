import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { ChartContainer, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { formatRupiah } from "@/lib/format"
import { rupiahTooltipValue } from "./components/chart-tooltip"

// jsdom has no layout; `ResponsiveContainer` would never draw its child.
vi.mock("recharts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
}))

const config: ChartConfig = {
  cash: { label: "Tunai", color: "var(--chart-1)" },
  qris: { label: "QRIS", color: "var(--chart-2)" },
}

const payload = [
  {
    graphicalItemId: "cash",
    name: "cash",
    dataKey: "cash",
    value: 150000,
    color: "var(--color-cash)",
    payload: {},
  },
  {
    graphicalItemId: "qris",
    name: "qris",
    dataKey: "qris",
    value: 50000,
    color: "var(--color-qris)",
    payload: {},
  },
]

/** `Intl` puts a non-breaking space after "Rp"; the DOM text is normalised. */
function rupiahText(amount: number) {
  return formatRupiah(amount).replace(/\s/g, " ")
}

/**
 * The dashboard charts used to hand `ChartTooltipContent` a formatter that
 * returned a whole row (marker, method name, amount). The tooltip draws the
 * marker and the name itself, so each row showed them twice.
 */
describe("dashboard chart tooltip", () => {
  it("shows each method's marker, name and amount exactly once", () => {
    const { container } = render(
      <ChartContainer config={config}>
        <ChartTooltipContent
          active
          formatter={rupiahTooltipValue}
          label="2026-09-01"
          labelFormatter={() => "1 September 2026"}
          payload={payload}
        />
      </ChartContainer>,
    )

    expect(screen.getAllByText("Tunai")).toHaveLength(1)
    expect(screen.getAllByText("QRIS")).toHaveLength(1)
    expect(screen.getAllByText(rupiahText(150000))).toHaveLength(1)
    expect(screen.getAllByText(rupiahText(50000))).toHaveLength(1)
    expect(container.querySelectorAll(".rounded-\\[2px\\]")).toHaveLength(2)
    expect(screen.getByText("1 September 2026")).toBeInTheDocument()
  })
})

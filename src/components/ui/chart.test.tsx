import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { ChartContainer, ChartTooltipContent, type ChartConfig } from "./chart"

// jsdom tidak punya tata letak, jadi `ResponsiveContainer` mengukur 0x0 dan tidak
// pernah menggambar anaknya. Tooltip tidak butuh ukuran — cukup diteruskan.
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
    color: "var(--chart-1)",
    payload: {},
  },
  {
    graphicalItemId: "qris",
    name: "qris",
    dataKey: "qris",
    value: 50000,
    color: "var(--chart-2)",
    payload: {},
  },
]

function renderTooltip(props: Partial<Parameters<typeof ChartTooltipContent>[0]> = {}) {
  return render(
    <ChartContainer config={config}>
      <ChartTooltipContent active label="1 Sep" payload={payload} {...props} />
    </ChartContainer>,
  )
}

describe("ChartTooltipContent", () => {
  it("keeps the series label and colour indicator when a formatter is passed", () => {
    const { container } = renderTooltip({ formatter: (value) => `Rp ${String(value)}` })

    expect(screen.getByText("Tunai")).toBeInTheDocument()
    expect(screen.getByText("QRIS")).toBeInTheDocument()
    expect(screen.getByText("Rp 150000")).toBeInTheDocument()
    expect(screen.getByText("Rp 50000")).toBeInTheDocument()
    expect(container.querySelectorAll(".rounded-\\[2px\\]")).toHaveLength(2)
  })

  it("lets a formatter rename the series with a [value, name] tuple, as in recharts", () => {
    renderTooltip({ formatter: (value, name) => [`Rp ${String(value)}`, `Metode ${String(name)}`] })

    expect(screen.getByText("Metode cash")).toBeInTheDocument()
    expect(screen.queryByText("Tunai")).not.toBeInTheDocument()
  })

  it("formats raw numbers the Indonesian way without a formatter", () => {
    renderTooltip()

    expect(screen.getByText("150.000")).toBeInTheDocument()
    expect(screen.getByText("Tunai")).toBeInTheDocument()
  })
})

import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { id } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import { SalesSummaryCards } from "./sales-summary-cards"

const totals = { transactions: 3, revenue: 30000, cost: 20000, profit: 10000 }

describe("SalesSummaryCards", () => {
  it("renders nothing when not loading and no totals", () => {
    const { container } = render(<SalesSummaryCards totals={undefined} isLoading={false} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders four cards with formatted values", () => {
    const { container } = render(<SalesSummaryCards totals={totals} isLoading={false} />)
    expect(screen.getByText(id.reports.stat.totalTransactions)).toBeTruthy()
    expect(container.textContent).toContain(formatRupiah(30000))
    expect(container.textContent).toContain(formatRupiah(10000))
    expect(screen.queryByText(id.reports.stat.avgPerTransaction)).toBeNull()
  })

  it("renders the average card when requested", () => {
    const { container } = render(
      <SalesSummaryCards totals={totals} isLoading={false} withAverage averagePerTransaction={12345} />,
    )
    expect(screen.getByText(id.reports.stat.avgPerTransaction)).toBeTruthy()
    expect(container.textContent).toContain(formatRupiah(12345))
  })

  it("renders cards while loading without totals", () => {
    render(<SalesSummaryCards totals={undefined} isLoading />)
    expect(screen.getByText(id.reports.stat.grossProfit)).toBeTruthy()
  })
})

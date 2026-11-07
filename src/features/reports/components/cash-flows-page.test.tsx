import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { id } from "@/i18n/id"

const useCashFlowsMock = vi.fn()

vi.mock("../hooks/use-report-date-range", () => ({
  useReportDateRange: () => ({
    dateRange: null,
    setDateRange: vi.fn(),
    startDate: "2026-11-01",
    endDate: "2026-11-07",
  }),
}))

vi.mock("../hooks/use-reports", () => ({
  useCashFlows: (...args: unknown[]) => useCashFlowsMock(...args),
}))

vi.mock("@/components/date-range-picker", () => ({
  DateRangePicker: () => <div data-testid="date-range-picker" />,
}))

import { CashFlowsPage } from "./cash-flows-page"

describe("CashFlowsPage", () => {
  beforeEach(() => {
    useCashFlowsMock.mockReset()
  })

  it("queries cash flows with the selected date range", () => {
    useCashFlowsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      error: null,
      refetch: vi.fn(),
    })
    render(<CashFlowsPage />)
    expect(useCashFlowsMock).toHaveBeenCalledWith("2026-11-01", "2026-11-07")
    expect(screen.getByText(id.reports.stat.totalIn)).toBeInTheDocument()
  })

  it("labels in and out rows by flow type", () => {
    useCashFlowsMock.mockReturnValue({
      data: {
        totalIn: 50000,
        totalOut: 20000,
        netTotal: 30000,
        items: [
          {
            id: 1,
            flowType: "in",
            amount: 50000,
            description: "Modal awal",
            cashierName: "Budi",
            createdAt: "2026-11-05T03:00:00Z",
          },
          {
            id: 2,
            flowType: "out",
            amount: 20000,
            description: "Beli plastik",
            cashierName: "Sari",
            createdAt: "2026-11-05T04:00:00Z",
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<CashFlowsPage />)
    expect(screen.getByText("Modal awal")).toBeInTheDocument()
    expect(screen.getByText("Beli plastik")).toBeInTheDocument()
    expect(screen.getByText(id.reports.cashIn)).toBeInTheDocument()
    expect(screen.getByText(id.reports.cashOut)).toBeInTheDocument()
    expect(screen.getByText("Sari")).toBeInTheDocument()
  })
})

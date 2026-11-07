import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

import { id } from "@/i18n/id"

const useLossesMock = vi.fn()

vi.mock("../hooks/use-report-date-range", () => ({
  useReportDateRange: () => ({
    dateRange: null,
    setDateRange: vi.fn(),
    startDate: "2026-11-01",
    endDate: "2026-11-07",
  }),
}))

vi.mock("../hooks/use-reports", () => ({
  useLosses: (...args: unknown[]) => useLossesMock(...args),
}))

vi.mock("@/components/date-range-picker", () => ({
  DateRangePicker: () => <div data-testid="date-range-picker" />,
}))

import { LossesPage } from "./losses-page"

describe("LossesPage", () => {
  beforeEach(() => {
    useLossesMock.mockReset()
  })

  it("queries losses with the selected date range", () => {
    useLossesMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      error: null,
      refetch: vi.fn(),
    })
    render(<LossesPage />)
    expect(useLossesMock).toHaveBeenCalledWith("2026-11-01", "2026-11-07")
    expect(screen.getByText(id.reports.stat.totalWriteoffs)).toBeInTheDocument()
  })

  it("renders write-off rows and notes", () => {
    useLossesMock.mockReturnValue({
      data: {
        totalWriteoffs: 1,
        totalQuantity: 3,
        totalLossValue: 15000,
        byReason: [{ reason: "damaged", count: 1, totalValue: 15000 }],
        items: [
          {
            id: 1,
            writeoffNumber: "WO-20261105-0001",
            productName: "Beras 5kg",
            notes: "Karung sobek",
            quantity: 3,
            reason: "damaged",
            lossValue: 15000,
            status: "approved",
            createdAt: "2026-11-05T03:00:00Z",
            cashierName: "Budi",
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<LossesPage />)
    expect(screen.getByText("WO-20261105-0001")).toBeInTheDocument()
    expect(screen.getByText("Beras 5kg")).toBeInTheDocument()
    expect(screen.getByText("Karung sobek")).toBeInTheDocument()
    expect(screen.getByText("Budi")).toBeInTheDocument()
  })
})

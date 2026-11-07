import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { transactionStatusLabel } from "@/lib/labels"

const hookResult = {
  data: [
    {
      id: 1,
      receiptNumber: "TRX-20261107-0001",
      cashierName: "Budi",
      paymentMethod: "cash",
      status: "completed",
      createdAt: "2026-11-07T03:00:00Z",
      totalItems: 2,
      totalAmount: 10_000,
    },
    {
      id: 2,
      receiptNumber: "TRX-20261107-0002",
      cashierName: "Sari",
      paymentMethod: "qris",
      status: "partial_refund",
      createdAt: "2026-11-07T04:00:00Z",
      totalItems: 1,
      totalAmount: 5_000,
    },
  ],
  isLoading: false,
  isFetching: false,
  error: null,
  refetch: vi.fn(),
}

vi.mock("../hooks/use-dashboard", () => ({
  useRecentTransactions: () => hookResult,
}))

import { RecentTransactionsTable } from "./recent-transactions-table"

describe("RecentTransactionsTable", () => {
  it("renders receipts and cashiers", () => {
    render(<RecentTransactionsTable />)
    expect(screen.getByText("TRX-20261107-0001")).toBeInTheDocument()
    expect(screen.getByText("Sari")).toBeInTheDocument()
  })

  it("flags only non-completed transactions with a status badge", () => {
    render(<RecentTransactionsTable />)
    expect(screen.getAllByText(transactionStatusLabel("partial_refund"))).toHaveLength(1)
    expect(screen.queryByText(transactionStatusLabel("completed"))).not.toBeInTheDocument()
  })
})

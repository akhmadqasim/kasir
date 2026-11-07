import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { formatRupiah } from "@/lib/format"

const rp = (value: number) => formatRupiah(value).replace(/\s+/g, " ")
import { paymentMethodLabel } from "@/lib/labels"

const hookResult = {
  data: [
    { method: "qris", count: 1, total: 25_000 },
    { method: "cash", count: 3, total: 75_000 },
  ],
  isLoading: false,
  isFetching: false,
  error: null,
  refetch: vi.fn(),
}

vi.mock("../hooks/use-dashboard", () => ({
  usePaymentMethodStats: () => hookResult,
}))

import { PaymentBreakdownTable } from "./payment-breakdown-table"

describe("PaymentBreakdownTable", () => {
  it("sorts methods by total, descending", () => {
    render(<PaymentBreakdownTable />)
    const cash = screen.getByText(paymentMethodLabel("cash"))
    const qris = screen.getByText(paymentMethodLabel("qris"))
    expect(cash.compareDocumentPosition(qris) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText(rp(75_000))).toBeInTheDocument()
  })

  it("shows each method's share of the absolute total", () => {
    render(<PaymentBreakdownTable />)
    expect(screen.getByText(/^75.*%$/)).toBeInTheDocument()
    expect(screen.getByText(/^25.*%$/)).toBeInTheDocument()
  })
})

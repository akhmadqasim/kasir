import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import type { TransactionDetail } from "../types"
import { TransactionPaymentSummary } from "./transaction-payment-summary"

function makeDetail(overrides: Record<string, unknown> = {}): TransactionDetail {
  return {
    transaction: {
      id: 1,
      status: "completed",
      subtotal_amount: 20000,
      discount_amount: 0,
      total_amount: 20000,
      payment_method: "cash",
      payment_amount: 50000,
      change_amount: 30000,
      ...overrides,
    },
    items: [],
    payment_breakdown: [],
  } as unknown as TransactionDetail
}

describe("TransactionPaymentSummary", () => {
  it("shows total, paid amount and change", () => {
    render(<TransactionPaymentSummary detail={makeDetail()} />)
    expect(screen.getByText("Ringkasan Pembayaran")).toBeInTheDocument()
    expect(screen.getByText(/50\.000/)).toBeInTheDocument()
    expect(screen.getByText(/30\.000/)).toBeInTheDocument()
    expect(screen.queryByText("Diskon")).not.toBeInTheDocument()
  })

  it("shows subtotal and discount when discounted", () => {
    render(
      <TransactionPaymentSummary
        detail={makeDetail({ discount_amount: 2000, total_amount: 18000 })}
      />,
    )
    expect(screen.getByText("Subtotal")).toBeInTheDocument()
    expect(screen.getByText(/^-Rp.*2\.000$/)).toBeInTheDocument()
  })

  it("shows the pre-void total for a deleted transaction", () => {
    render(
      <TransactionPaymentSummary
        detail={makeDetail({ status: "deleted", total_amount: 0, change_amount: 0 })}
      />,
    )
    expect(screen.getByText("Total sebelum hapus")).toBeInTheDocument()
  })
})

import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import { installApiMock, type ApiCall } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import type { PaginatedTransactions, TransactionListItem } from "./types"

import { TransactionsPage } from "./components/transactions-page"

function row(id: number): TransactionListItem {
  return {
    id,
    receipt_number: `TRX-20260905-000${id}`,
    user_id: 1,
    cashier_name: "Ahmad",
    total_amount: 25000,
    subtotal_amount: 25000,
    discount_amount: 0,
    payment_method: "cash",
    payment_amount: 25000,
    change_amount: 0,
    status: "completed",
    channel: "sales",
    item_count: 1,
    notes: null,
    created_at: "2026-09-05 03:00:00",
    has_refundable_goods: true,
    has_refundable_failed_ppob: false,
    ppob_service_type: null,
    ppob_advice: null,
    has_ppob: false,
    ppob_status: null,
    ppob_message: null,
    ppob_serial_number: null,
    deleted_at: null,
    deleted_reason: null,
    payment_breakdown: [],
  }
}

function pageOf(
  data: TransactionListItem[],
  page: number,
  totalPages: number,
): PaginatedTransactions {
  return { data, total: data.length, page, per_page: 50, total_pages: totalPages }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TestNavbar>
          <TransactionsPage />
        </TestNavbar>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("transaction history pagination", () => {
  it("goes back to the first page when a filter changes", async () => {
    const api = installApiMock({
      "GET /transactions": (call: ApiCall) =>
        pageOf([row(Number(call.query.get("page")))], Number(call.query.get("page")), 3),
    })
    renderPage()

    await screen.findByText("TRX-20260905-0001")
    fireEvent.click(screen.getByRole("button", { name: /Selanjutnya/ }))
    await screen.findByText("TRX-20260905-0002")

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "TRX" } })

    await vi.waitFor(() => {
      const last = api.lastCall("GET /transactions")
      expect(last?.query.get("search")).toBe("TRX")
      expect(last?.query.get("page")).toBe("1")
    })
  })

  // Repro: filter status "Selesai", go to page 2 (its only row), refund that sale in
  // another tab, press "Muat ulang" → the server now has one page. Without the clamp
  // the table showed "Tidak ada transaksi" and the pagination disappeared.
  it("falls back to the last page that still exists after the list shrinks", async () => {
    let totalPages = 2
    const api = installApiMock({
      "GET /transactions": (call: ApiCall) => {
        const page = Number(call.query.get("page"))
        const data = page <= totalPages ? [row(page)] : []
        return pageOf(data, page, totalPages)
      },
    })
    renderPage()

    await screen.findByText("TRX-20260905-0001")
    fireEvent.click(screen.getByRole("button", { name: /Selanjutnya/ }))
    await screen.findByText("TRX-20260905-0002")

    totalPages = 1
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang" }))

    await vi.waitFor(() => expect(api.lastCall("GET /transactions")?.query.get("page")).toBe("1"))
    expect(await screen.findByText("TRX-20260905-0001")).toBeInTheDocument()
  })
})

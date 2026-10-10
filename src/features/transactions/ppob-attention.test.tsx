import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import { PpobAttentionBadge } from "./components/ppob-attention-badge"
import { TransactionsPage } from "./components/transactions-page"
import type { PaginatedTransactions, TransactionListItem } from "./types"

const ROW: TransactionListItem = {
  id: 1,
  receipt_number: "TRX-20260905-0001",
  user_id: 1,
  cashier_name: "Ahmad",
  total_amount: 51000,
  subtotal_amount: 51000,
  discount_amount: 0,
  payment_method: "cash",
  payment_amount: 51000,
  change_amount: 0,
  status: "completed",
  channel: "sales",
  item_count: 2,
  notes: null,
  created_at: "2026-09-05 03:00:00",
  has_refundable_goods: true,
  has_refundable_failed_ppob: false,
  has_ppob: true,
  ppob_status: "uncertain",
  ppob_message: null,
  ppob_serial_number: null,
  ppob_service_type: "pln",
  ppob_advice: "{}",
  deleted_at: null,
  deleted_reason: null,
  payment_breakdown: [],
}

const PAGE: PaginatedTransactions = {
  data: [
    ROW,
    {
      ...ROW,
      id: 2,
      receipt_number: "TRX-20260905-0002",
      ppob_status: "failed",
      ppob_advice: null,
    },
  ],
  total: 2,
  page: 1,
  per_page: 50,
  total_pages: 1,
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderPage() {
  return render(
    <QueryClientProvider client={client()}>
      <MemoryRouter>
        <TestNavbar>
          <TransactionsPage />
        </TestNavbar>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let api: ApiMock

beforeEach(() => {
  api = installApiMock({
    "GET /transactions/ppob-attention": { uncertain: 3 },
    "GET /transactions": PAGE,
  })
})

describe("PPOB lines that need a person", () => {
  it("badges each row with its PPOB state, apart from the sale status", async () => {
    renderPage()

    const first = (await screen.findByText("TRX-20260905-0001")).closest("tr")!
    expect(within(first).getByText("Selesai")).toBeInTheDocument()
    expect(within(first).getByText("Menunggu Konfirmasi PLN")).toBeInTheDocument()
    const second = screen.getByText("TRX-20260905-0002").closest("tr")!
    expect(within(second).getByText("PPOB gagal")).toBeInTheDocument()
  })

  it("points at the uncertain lines of any day and lists them on one press", async () => {
    renderPage()

    expect(await screen.findByText("3 PPOB perlu dicek")).toBeInTheDocument()
    // Today's sales first, as before.
    await waitFor(() =>
      expect(api.lastCall("GET /transactions")?.query.get("date_from")).toBeTruthy(),
    )

    fireEvent.click(screen.getByRole("button", { name: "Tampilkan" }))

    await waitFor(() =>
      expect(api.lastCall("GET /transactions")?.query.get("status")).toBe("ppob_uncertain"),
    )
    const query = api.lastCall("GET /transactions")!.query
    expect(query.get("date_from")).toBeNull()
    expect(query.get("channel")).toBeNull()
    // Already on that list: the banner has nothing left to offer.
    expect(screen.queryByRole("button", { name: "Tampilkan" })).not.toBeInTheDocument()
  })

  it("shows the count in the sidebar, and nothing at zero", async () => {
    const { unmount } = render(
      <QueryClientProvider client={client()}>
        <PpobAttentionBadge />
      </QueryClientProvider>,
    )
    expect(await screen.findByText("3 PPOB perlu dicek")).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
    unmount()

    api.route("GET /transactions/ppob-attention", { uncertain: 0 })
    const { container } = render(
      <QueryClientProvider client={client()}>
        <PpobAttentionBadge />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(api.callsFor("GET /transactions/ppob-attention")).toHaveLength(2))
    expect(container).toBeEmptyDOMElement()
  })
})

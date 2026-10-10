import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { installApiMock, type ApiCall, type ApiMock } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { ListWriteoffsResult, StockWriteoff } from "./types"

import { StockWriteoffPage } from "./components/stock-writeoff-page"

function writeoff(overrides: Partial<StockWriteoff> = {}): StockWriteoff {
  return {
    id: 1,
    writeoffNumber: "WO-20260905-0001",
    productId: 5,
    productName: "Telur Ayam 1kg",
    userId: 2,
    cashierName: "Budi",
    quantity: 2,
    reason: "damaged",
    lossValue: 50000,
    notes: null,
    approvedBy: null,
    approverName: null,
    status: "pending",
    refundId: null,
    createdAt: "2026-09-05 03:00:00",
    ...overrides,
  }
}

function listOf(items: StockWriteoff[], page = 1, totalPages = 1): ListWriteoffsResult {
  return { items, total: items.length, page, perPage: 50, totalPages }
}

function loginAs(role: "admin" | "kasir") {
  useAuthStore.setState({
    user: {
      id: role === "admin" ? 1 : 2,
      username: role,
      full_name: role,
      role,
      is_active: true,
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00",
    },
  })
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TestNavbar>
        <StockWriteoffPage />
      </TestNavbar>
    </QueryClientProvider>,
  )
}

let api: ApiMock

beforeEach(() => {
  api = installApiMock({
    "GET /stock/writeoffs": listOf([
      writeoff(),
      writeoff({ id: 2, writeoffNumber: "WO-20260905-0002", refundId: 9 }),
      writeoff({ id: 3, writeoffNumber: "WO-20260905-0003", status: "approved" }),
    ]),
    "POST /stock/writeoffs/*/approve": writeoff({ status: "approved" }),
    "POST /stock/writeoffs/*/reject": writeoff({ status: "rejected" }),
  })
})

describe("stock write-off list", () => {
  it("offers approve and reject on pending rows to an admin only", async () => {
    loginAs("admin")
    renderPage()

    expect(await screen.findByRole("button", { name: "Setujui WO-20260905-0001" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Tolak WO-20260905-0001" })).toBeVisible()
    // An approved write-off is settled.
    expect(screen.queryByRole("button", { name: "Setujui WO-20260905-0003" })).toBeNull()
  })

  it("does not offer to delete a write-off that came from a refund", async () => {
    loginAs("admin")
    renderPage()

    expect(await screen.findByRole("button", { name: "Hapus WO-20260905-0001" })).toBeVisible()
    expect(screen.queryByRole("button", { name: "Hapus WO-20260905-0002" })).toBeNull()
    expect(screen.getByRole("button", { name: "Tolak WO-20260905-0002" })).toBeVisible()
  })

  it("gives a cashier no approve, reject or delete actions", async () => {
    loginAs("kasir")
    renderPage()

    await screen.findByText("WO-20260905-0001")
    expect(screen.queryByRole("button", { name: /^Setujui WO-/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Tolak WO-/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Hapus WO-/ })).toBeNull()
  })

  it("approves only after the admin confirms", async () => {
    loginAs("admin")
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "Setujui WO-20260905-0001" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(api.callsFor("POST /stock/writeoffs/*/approve")).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole("button", { name: "Setujui" }))

    await vi.waitFor(() =>
      expect(api.callsFor("POST /stock/writeoffs/*/approve").map((c) => c.path)).toEqual([
        "/stock/writeoffs/1/approve",
      ]),
    )
  })

  it("moves back to the last page when the current one empties out", async () => {
    loginAs("admin")
    let totalPages = 2
    api.route("GET /stock/writeoffs", (call: ApiCall) => {
      const page = Number(call.query.get("page"))
      return page <= totalPages
        ? listOf(
            [writeoff({ id: page, writeoffNumber: `WO-20260905-000${page}` })],
            page,
            totalPages,
          )
        : listOf([], page, totalPages)
    })
    renderPage()

    await screen.findByText("WO-20260905-0001")
    fireEvent.click(screen.getByRole("button", { name: /Selanjutnya/ }))
    await screen.findByText("WO-20260905-0002")

    totalPages = 1
    fireEvent.click(screen.getByRole("button", { name: "Tolak WO-20260905-0002" }))
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Tolak" }),
    )

    await vi.waitFor(() =>
      expect(api.lastCall("GET /stock/writeoffs")?.query.get("page")).toBe("1"),
    )
    expect(await screen.findByText("WO-20260905-0001")).toBeInTheDocument()
  })
})

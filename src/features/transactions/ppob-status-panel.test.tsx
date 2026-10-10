import { describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import { apiFailure, installApiMock } from "@/test-utils/api-mock"
import { PpobStatusPanel } from "./components/ppob-status-panel"
import { usePpobCheck } from "./hooks/use-ppob-check"
import type { TransactionDetailItem } from "./types"

const SOLD_AT = "2026-09-01 10:00:00"
const SOLD_MS = Date.parse("2026-09-01T10:00:00Z")
const HOUR = 60 * 60 * 1000

const LINE: TransactionDetailItem = {
  id: 21,
  transaction_id: 3,
  product_id: null,
  product_name: "Token PLN 50.000",
  product_price: 51000,
  buy_price: 50500,
  quantity: 1,
  subtotal: 51000,
  item_discount: 0,
  net_subtotal: 51000,
  service_type: "pln",
  service_ref: "12345678901",
  ppob_product_id: 5,
  ppob_product_code: "PLN50",
  ppob_inquiry_id: null,
  ppob_payment_code: null,
  ppob_flag_id: null,
  ppob_status: "uncertain",
  ppob_message: null,
  ppob_serial_number: null,
  created_at: SOLD_AT,
  ppob_advice: "{}",
  ppob_last_attempt_at: null,
  refunded_quantity: 0,
  refundable: false,
  refundable_quantity: 0,
  // The server opens "Tandai Gagal" on an ADVICE line 24 hours after the sale.
  ppob_manual_fail_opens_at: "2026-09-02 10:00:00",
}

function renderPanel(item: TransactionDetailItem, isAdmin: boolean, now: Date) {
  const onResolve = vi.fn()
  render(
    <PpobStatusPanel
      checkingId={null}
      isAdmin={isAdmin}
      item={item}
      now={now}
      showName={false}
      onCheck={() => {}}
      onResolve={onResolve}
    />,
  )
  return { onResolve }
}

describe("PPOB status panel settle buttons", () => {
  it("shows a kasir only Cek status, and says an admin settles by hand", () => {
    renderPanel(LINE, false, new Date(SOLD_MS + 48 * HOUR))

    expect(screen.getByRole("button", { name: /Cek status/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Tandai Berhasil/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Tandai Gagal/ })).not.toBeInTheDocument()
    expect(screen.getByText(/minta admin menandai hasilnya/)).toBeInTheDocument()
  })

  it("keeps 'Tandai Gagal' shut for 24 hours after an ADVICE, and says until when", () => {
    const { onResolve } = renderPanel(LINE, true, new Date(SOLD_MS + 2 * HOUR))

    expect(screen.getByRole("button", { name: /Tandai Berhasil/ })).toBeEnabled()
    // The tooltip wrapper is a focusable `role=button` too; the real one is the <button>.
    const markFailed = screen
      .getAllByRole("button", { name: /Tandai Gagal/ })
      .find((element) => element.tagName === "BUTTON")
    expect(markFailed).toBeDisabled()
    expect(screen.getByText(/Tandai Gagal baru bisa .*24 jam/)).toBeInTheDocument()
    fireEvent.click(markFailed!)
    expect(onResolve).not.toHaveBeenCalled()
  })

  it("opens 'Tandai Gagal' for an admin once the 24 hours are over", () => {
    const { onResolve } = renderPanel(LINE, true, new Date(SOLD_MS + 25 * HOUR))

    fireEvent.click(screen.getByRole("button", { name: /Tandai Gagal/ }))
    expect(onResolve).toHaveBeenCalledWith(LINE, false)
    expect(screen.queryByText(/Tandai Gagal baru bisa/)).not.toBeInTheDocument()
  })

  it("lets an admin mark a line with no answer at all failed right away", () => {
    const noAnswer = { ...LINE, ppob_advice: null, ppob_manual_fail_opens_at: null }
    const { onResolve } = renderPanel(noAnswer, true, new Date(SOLD_MS + 60_000))

    fireEvent.click(screen.getByRole("button", { name: /Tandai Gagal/ }))
    expect(onResolve).toHaveBeenCalledWith(noAnswer, false)
  })
})

describe("usePpobCheck", () => {
  // The reconcile loop settled the line after this screen loaded; the server
  // refuses the check. The stale buttons must go, so the detail is refetched.
  it("refreshes the transaction queries when the check is refused", async () => {
    const api = installApiMock({
      "POST /transaction-items/*/ppob/check": apiFailure(
        400,
        "validation",
        "Hanya item PPOB yang statusnya belum pasti yang bisa dicek",
      ),
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, "invalidateQueries")
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => usePpobCheck(), { wrapper })

    await act(() => result.current.check(21))

    expect(api.callsFor("POST /transaction-items/21/ppob/check")).toHaveLength(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["transactions"] })
    expect(result.current.checkingId).toBeNull()
  })
})

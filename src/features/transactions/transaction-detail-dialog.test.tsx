import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { User } from "@/features/auth/types"
import { TransactionDetailDialog } from "./components/transaction-detail-dialog"
import type { TransactionDetail, TransactionListItem } from "./types"

const KASIR: User = {
  id: 2,
  username: "kasir01",
  full_name: "Kasir Satu",
  role: "kasir",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

const LISTED: TransactionListItem = {
  id: 1,
  receipt_number: "TRX-20260905-0001",
  user_id: KASIR.id,
  cashier_name: "Kasir Satu",
  total_amount: 12000,
  subtotal_amount: 12000,
  discount_amount: 0,
  payment_method: "cash",
  payment_amount: 12000,
  change_amount: 0,
  status: "completed",
  item_count: 1,
  notes: null,
  created_at: "2026-09-05 03:00:00",
  has_ppob: true,
  ppob_status: "failed",
  ppob_message: "Provider timeout",
  ppob_serial_number: null,
  deleted_at: null,
  deleted_reason: null,
  payment_breakdown: [{ payment_method: "cash", amount: 12000 }],
}

/** A single PPOB line whose upstream fulfilment failed — the one case that offers Retry. */
const DETAIL: TransactionDetail = {
  transaction: {
    id: 1,
    receipt_number: "TRX-20260905-0001",
    user_id: KASIR.id,
    total_amount: 12000,
    subtotal_amount: 12000,
    discount_amount: 0,
    payment_method: "cash",
    payment_amount: 12000,
    change_amount: 0,
    status: "completed",
    notes: null,
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    updated_at: null,
    created_at: "2026-09-05 03:00:00",
  },
  items: [
    {
      id: 10,
      transaction_id: 1,
      product_id: null,
      product_name: "Pulsa Telkomsel 10K",
      product_price: 12000,
      buy_price: 10000,
      quantity: 1,
      subtotal: 12000,
      item_discount: 0,
      net_subtotal: 12000,
      service_type: "pulsa",
      service_ref: "08123456789",
      ppob_product_id: 101,
      ppob_product_code: "TS10",
      ppob_inquiry_id: null,
      ppob_payment_code: null,
      ppob_flag_id: null,
      ppob_status: "failed",
      ppob_message: "Provider timeout",
      ppob_serial_number: null,
      created_at: "2026-09-05 03:00:00",
    },
  ],
  cashier_name: "Kasir Satu",
  has_ppob: true,
  ppob_status: "failed",
  ppob_message: "Provider timeout",
  ppob_serial_number: null,
  payment_breakdown: [{ payment_method: "cash", amount: 12000 }],
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TransactionDetailDialog transaction={LISTED} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let api: ApiMock

beforeEach(() => {
  useAuthStore.setState({ user: KASIR })
  api = installApiMock({
    "GET /transactions/*": DETAIL,
    "POST /transaction-items/*/ppob/retry": "PPOB fulfillment sedang diproses ulang",
  })
})

/**
 * The PIN used to travel nowhere near this button — a retry just replayed
 * whatever the settings screen had stored. Now every retry asks for it again,
 * because it is never kept anywhere between attempts.
 */
describe("retry PPOB dari riwayat transaksi", () => {
  it("meminta PIN sebelum retry, bukan langsung memanggil retry", async () => {
    renderDialog()

    fireEvent.click(await screen.findByRole("button", { name: /Retry PPOB/ }))

    expect(await screen.findByLabelText("PIN Mitra")).toBeInTheDocument()
    expect(api.callsFor("POST /transaction-items/*/ppob/retry")).toHaveLength(0)
  })

  it("mematikan tombol retry di dialog sampai PIN 4-6 digit terisi", async () => {
    renderDialog()
    fireEvent.click(await screen.findByRole("button", { name: /Retry PPOB/ }))
    const pinField = await screen.findByLabelText("PIN Mitra")

    const confirmButtons = screen.getAllByRole("button", { name: "Retry PPOB" })
    const confirmButton = confirmButtons[confirmButtons.length - 1]
    expect(confirmButton).toBeDisabled()

    fireEvent.change(pinField, { target: { value: "12" } })
    expect(confirmButton).toBeDisabled()

    fireEvent.change(pinField, { target: { value: "123456" } })
    expect(confirmButton).toBeEnabled()
  })

  it("mengirim PIN yang diketik ke endpoint retry", async () => {
    renderDialog()
    fireEvent.click(await screen.findByRole("button", { name: /Retry PPOB/ }))
    const pinField = await screen.findByLabelText("PIN Mitra")
    fireEvent.change(pinField, { target: { value: "654321" } })

    const confirmButtons = screen.getAllByRole("button", { name: "Retry PPOB" })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() =>
      expect(api.callsFor("POST /transaction-items/*/ppob/retry")).toHaveLength(1),
    )
    const call = api.lastCall("POST /transaction-items/*/ppob/retry")
    expect(call?.body).toEqual({ pin: "654321" })
  })

  it("mengosongkan PIN dan menutup dialog konfirmasi setelah berhasil", async () => {
    renderDialog()
    fireEvent.click(await screen.findByRole("button", { name: /Retry PPOB/ }))
    const pinField = await screen.findByLabelText("PIN Mitra")
    fireEvent.change(pinField, { target: { value: "654321" } })

    const confirmButtons = screen.getAllByRole("button", { name: "Retry PPOB" })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() => expect(screen.queryByLabelText("PIN Mitra")).not.toBeInTheDocument())
  })
})

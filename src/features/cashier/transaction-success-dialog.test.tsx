import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { pressKey } from "@/test-utils/keyboard"
import { TransactionSuccessDialog } from "./components/transaction-success-dialog"
import type { TransactionItem, TransactionResult } from "./types"

/** Jawaban `POST /api/transactions` — satu-satunya sumber data dialog ini. */
const RESULT: TransactionResult = {
  transaction: {
    id: 1,
    receipt_number: "TRX-20260913-0001",
    user_id: 2,
    total_amount: 6000,
    subtotal_amount: 6000,
    discount_amount: 0,
    payment_method: "cash",
    payment_amount: 50000,
    change_amount: 44000,
    status: "completed",
    notes: null,
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    updated_at: null,
    created_at: "2026-09-13 01:00:00",
  },
  items: [],
  payment_breakdown: [{ payment_method: "cash", bank_name: null, amount: 50000 }],
}

const PPOB_LINE: TransactionItem = {
  id: 11,
  transaction_id: 1,
  product_id: null,
  product_name: "Pulsa Telkomsel 50.000",
  product_price: 51000,
  buy_price: 49500,
  quantity: 1,
  subtotal: 51000,
  item_discount: 0,
  net_subtotal: 51000,
  service_type: "pulsa",
  service_ref: "081234567890",
  ppob_product_id: 5,
  ppob_product_code: "TSEL50",
  ppob_inquiry_id: null,
  ppob_payment_code: null,
  ppob_flag_id: null,
  ppob_status: "pending",
  ppob_message: null,
  ppob_serial_number: null,
  created_at: "2026-09-13 01:00:00",
}

interface RenderOptions {
  result?: TransactionResult
  autoPrint?: boolean | undefined
  onNewTransaction?: () => void
}

function renderDialog({
  result = RESULT,
  autoPrint = false,
  onNewTransaction = () => {},
}: RenderOptions = {}) {
  return render(
    <TransactionSuccessDialog
      open
      result={result}
      autoPrint={autoPrint}
      onNewTransaction={onNewTransaction}
    />,
  )
}

let api: ApiMock

beforeEach(() => {
  api = installApiMock({
    "POST /transactions/*/print": null,
  })
})

describe("transaction success dialog", () => {
  it("renders the sale from the checkout response without asking the server", async () => {
    renderDialog()

    const dialog = await screen.findByRole("dialog", { name: "Transaksi tersimpan" })
    expect(dialog).toHaveTextContent("Rp 6.000")
    expect(dialog).toHaveTextContent("Rp 44.000")
    expect(dialog).toHaveTextContent("Kembalian dari Rp 50.000")
    expect(dialog).toHaveTextContent("Tunai")
    expect(dialog).toHaveTextContent("TRX-20260913-0001")
    // Tidak ada GET sama sekali: pengaturan printer datang dari CashierPage.
    expect(api.calls).toHaveLength(0)
  })

  it("hides the change when there is none to hand back", async () => {
    renderDialog({
      result: {
        ...RESULT,
        transaction: { ...RESULT.transaction, payment_method: "qris", change_amount: 0 },
        payment_breakdown: [],
      },
    })

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("QRIS")
    expect(dialog).not.toHaveTextContent("Kembalian")
  })

  it("lands focus on Transaksi baru so Enter starts the next sale", async () => {
    const onNewTransaction = vi.fn()
    renderDialog({ onNewTransaction })

    const newSale = await screen.findByRole("button", { name: "Transaksi baru" })
    await waitFor(() => expect(newSale).toHaveFocus())

    pressKey("Enter")

    expect(onNewTransaction).toHaveBeenCalledTimes(1)
  })

  it("closes on Escape", async () => {
    const onNewTransaction = vi.fn()
    renderDialog({ onNewTransaction })
    const dialog = await screen.findByRole("dialog")

    fireEvent.keyDown(dialog, { key: "Escape" })

    await waitFor(() => expect(onNewTransaction).toHaveBeenCalled())
  })

  it("prints once from the Cetak struk button", async () => {
    renderDialog()

    fireEvent.click(await screen.findByRole("button", { name: "Cetak struk" }))

    await waitFor(() => expect(api.callsFor("POST /transactions/1/print")).toHaveLength(1))
  })

  it("auto-prints once without a settings round trip and reports it inline", async () => {
    const onNewTransaction = vi.fn()
    renderDialog({ autoPrint: true, onNewTransaction })

    expect(await screen.findByText("Struk otomatis dicetak.")).toBeInTheDocument()
    expect(api.callsFor("POST /transactions/1/print")).toHaveLength(1)
    expect(api.calls.filter((call) => call.method === "GET")).toHaveLength(0)

    // Lalu menutup sendiri supaya kasir bisa langsung melayani berikutnya.
    await waitFor(() => expect(onNewTransaction).toHaveBeenCalledTimes(1), { timeout: 3000 })
  })

  it("waits for the printer settings before deciding on auto-print", async () => {
    const view = renderDialog({ autoPrint: undefined })
    await screen.findByRole("dialog")
    expect(api.callsFor("POST /transactions/1/print")).toHaveLength(0)

    view.rerender(
      <TransactionSuccessDialog open result={RESULT} autoPrint onNewTransaction={() => {}} />,
    )

    await waitFor(() => expect(api.callsFor("POST /transactions/1/print")).toHaveLength(1))
  })

  it("lists each PPOB line with its fulfilment status", async () => {
    renderDialog({ result: { ...RESULT, items: [PPOB_LINE] } })

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Pulsa Telkomsel 50.000")
    expect(dialog).toHaveTextContent("Menunggu")
  })
})

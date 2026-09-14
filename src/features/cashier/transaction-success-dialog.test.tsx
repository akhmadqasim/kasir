import { StrictMode, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

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

/** Baris yang dijawab GET receipt/lines di setiap test. */
const RECEIPT_LINES = [
  { text: "TOKO SEMBAKO JAYA", bold: true, size: "normal" },
  { text: "--------------------------------", bold: false, size: "normal" },
  { text: "Indomie Goreng", bold: false, size: "normal" },
  { text: "TOTAL Rp 6.000", bold: true, size: "normal" },
]

interface RenderOptions {
  result?: TransactionResult
  autoPrint?: boolean | undefined
  paperWidth?: number | null
  onNewTransaction?: () => void
}

/** One `QueryClient` per test, since `ReceiptPreview` reads receipt lines through it. */
function newQueryClient() {
  return new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
}

function withProviders(client: QueryClient, node: ReactNode) {
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

function renderDialog({
  result = RESULT,
  autoPrint = false,
  paperWidth = 58,
  onNewTransaction = () => {},
}: RenderOptions = {}) {
  return render(
    withProviders(
      newQueryClient(),
      <TransactionSuccessDialog
        open
        result={result}
        autoPrint={autoPrint}
        paperWidth={paperWidth}
        onNewTransaction={onNewTransaction}
      />,
    ),
  )
}

let api: ApiMock

beforeEach(() => {
  api = installApiMock({
    "POST /transactions/*/print": null,
    "GET /transactions/*/receipt/lines": RECEIPT_LINES,
  })
})

describe("transaction success dialog", () => {
  it("renders the sale from the checkout response without asking the server", async () => {
    renderDialog()

    const dialog = await screen.findByRole("dialog", { name: "Transaksi selesai" })
    // The headline figures: the total and the change to hand back.
    expect(dialog).toHaveTextContent("Rp 6.000")
    expect(dialog).toHaveTextContent("Rp 44.000")
    expect(dialog).toHaveTextContent("Kembalian")
    expect(dialog).not.toHaveTextContent("dari Rp 50.000")
    // Total, method and receipt number are read off the receipt preview, not
    // repeated above it.
    expect(dialog).not.toHaveTextContent("TRX-20260913-0001")
    // Tidak ada GET pengaturan printer: itu datang dari CashierPage. Yang tersisa
    // hanya baris struk pratinjau.
    expect(await screen.findByText("Indomie Goreng")).toBeInTheDocument()
    expect(api.callsFor("GET /transactions/1/receipt/lines")).toHaveLength(1)
    expect(api.calls).toHaveLength(1)
  })

  it("shows Rp 0 change when there is none to hand back", async () => {
    renderDialog({
      result: {
        ...RESULT,
        transaction: { ...RESULT.transaction, payment_method: "qris", change_amount: 0 },
        payment_breakdown: [],
      },
    })

    const dialog = await screen.findByRole("dialog")
    // Still a "Kembalian" row — reading Rp 0 beats hunting for a missing line.
    expect(dialog).toHaveTextContent("Kembalian")
    expect(dialog).toHaveTextContent("Rp 0")
  })

  it("prints on Enter wherever focus sits, without also pressing the focused button", async () => {
    const onNewTransaction = vi.fn()
    renderDialog({ onNewTransaction })

    const newSale = await screen.findByRole("button", { name: /Transaksi baru/ })
    await waitFor(() => expect(newSale).toHaveFocus())

    pressKey("Enter")

    await waitFor(() => expect(api.callsFor("POST /transactions/1/print")).toHaveLength(1))
    expect(onNewTransaction).not.toHaveBeenCalled()
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

    fireEvent.click(await screen.findByRole("button", { name: /Cetak struk/ }))

    await waitFor(() => expect(api.callsFor("POST /transactions/1/print")).toHaveLength(1))
  })

  it("auto-prints once without a settings round trip and reports it inline", async () => {
    const onNewTransaction = vi.fn()
    renderDialog({ autoPrint: true, onNewTransaction })

    expect(await screen.findByText("Struk otomatis dicetak.")).toBeInTheDocument()
    expect(api.callsFor("POST /transactions/1/print")).toHaveLength(1)
    // Bukan pengaturan printer — hanya baris struk pratinjau.
    expect(api.calls.filter((call) => call.method === "GET")).toHaveLength(1)
    expect(api.callsFor("GET /transactions/1/receipt/lines")).toHaveLength(1)

    // Lalu menutup sendiri supaya kasir bisa langsung melayani berikutnya.
    await waitFor(() => expect(onNewTransaction).toHaveBeenCalledTimes(1), { timeout: 3000 })
  })

  // `main.tsx` membungkus aplikasi dengan StrictMode, jadi setiap efek
  // berjalan, dibersihkan, lalu berjalan lagi saat mount. Cetak otomatis harus
  // tetap satu kali dan tetap melaporkan hasilnya.
  it("auto-prints once and still finishes under StrictMode", async () => {
    const onNewTransaction = vi.fn()
    render(
      <StrictMode>
        {withProviders(
          newQueryClient(),
          <TransactionSuccessDialog
            open
            result={RESULT}
            autoPrint
            paperWidth={58}
            onNewTransaction={onNewTransaction}
          />,
        )}
      </StrictMode>,
    )

    expect(await screen.findByText("Struk otomatis dicetak.")).toBeInTheDocument()
    expect(api.callsFor("POST /transactions/1/print")).toHaveLength(1)
    await waitFor(() => expect(onNewTransaction).toHaveBeenCalledTimes(1), { timeout: 3000 })
  })

  it("waits for the printer settings before deciding on auto-print", async () => {
    const client = newQueryClient()
    const view = render(
      withProviders(
        client,
        <TransactionSuccessDialog
          open
          result={RESULT}
          autoPrint={undefined}
          paperWidth={58}
          onNewTransaction={() => {}}
        />,
      ),
    )
    await screen.findByRole("dialog")
    expect(api.callsFor("POST /transactions/1/print")).toHaveLength(0)

    view.rerender(
      withProviders(
        client,
        <TransactionSuccessDialog
          open
          result={RESULT}
          autoPrint
          paperWidth={58}
          onNewTransaction={() => {}}
        />,
      ),
    )

    await waitFor(() => expect(api.callsFor("POST /transactions/1/print")).toHaveLength(1))
  })

  it("lists each PPOB line with its fulfilment status", async () => {
    renderDialog({ result: { ...RESULT, items: [PPOB_LINE] } })

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Pulsa Telkomsel 50.000")
    expect(dialog).toHaveTextContent("Menunggu")
  })

  it("shows a struk preview drawn from the exact lines the printer would get", async () => {
    renderDialog()

    const preview = await screen.findByLabelText("Pratinjau struk")
    await waitFor(() => expect(preview).toHaveTextContent("TOKO SEMBAKO JAYA"))
    for (const line of RECEIPT_LINES) {
      expect(preview).toHaveTextContent(line.text)
    }
    expect(api.callsFor("GET /transactions/1/receipt/lines")).toHaveLength(1)
  })

  it("asks the preview for the same paper width configured for printing", async () => {
    renderDialog({ paperWidth: 80 })

    await screen.findByLabelText("Pratinjau struk")

    const call = api.lastCall("GET /transactions/1/receipt/lines")
    expect(call?.query.get("paper")).toBe("80")
  })
})

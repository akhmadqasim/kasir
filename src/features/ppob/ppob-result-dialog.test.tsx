import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import type { TransactionResult } from "@/features/cashier/types"
import type { TransactionDetail, TransactionItem } from "@/features/transactions/types"
import { id } from "@/i18n/id"
import { toast } from "@/lib/toast"
import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { pressKey } from "@/test-utils/keyboard"
import { PpobResultDialog } from "./components/checkout/ppob-result-dialog"

const PPOB_LINE: TransactionItem = {
  id: 11,
  transaction_id: 7,
  product_id: null,
  product_name: "Token PLN 20.000",
  product_price: 21000,
  buy_price: 20500,
  quantity: 1,
  subtotal: 21000,
  item_discount: 0,
  net_subtotal: 21000,
  service_type: "pln",
  service_ref: "12345678901",
  ppob_product_id: 5,
  ppob_product_code: "PLN20",
  ppob_inquiry_id: null,
  ppob_payment_code: null,
  ppob_flag_id: null,
  ppob_status: "success",
  ppob_message: null,
  ppob_serial_number: "1111-2222-3333-4444",
  created_at: "2026-09-13 01:00:00",
}

const RESULT: TransactionResult = {
  transaction: {
    id: 7,
    receipt_number: "TRX-20260913-0007",
    user_id: 2,
    total_amount: 21000,
    subtotal_amount: 21000,
    discount_amount: 0,
    payment_method: "cash",
    payment_amount: 50000,
    change_amount: 29000,
    status: "completed",
    channel: "ppob",
    notes: null,
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    updated_at: null,
    created_at: "2026-09-13 01:00:00",
  },
  items: [PPOB_LINE],
  payment_breakdown: [{ payment_method: "cash", bank_name: null, amount: 50000 }],
}

const DETAIL: TransactionDetail = {
  transaction: RESULT.transaction,
  items: [
    {
      ...PPOB_LINE,
      refunded_quantity: 0,
      refundable: false,
      refundable_quantity: 0,
      ppob_manual_fail_opens_at: null,
    },
  ],
  cashier_name: "Kasir Satu",
  has_refundable_goods: false,
  has_refundable_failed_ppob: false,
  has_ppob: true,
  ppob_status: "success",
  ppob_message: null,
  ppob_serial_number: PPOB_LINE.ppob_serial_number,
  payment_breakdown: RESULT.payment_breakdown,
}

let api: ApiMock

beforeEach(() => {
  vi.mocked(toast.warning).mockClear()
  api = installApiMock({
    "GET /transactions/7": DETAIL,
    "POST /transactions/*/print": null,
  })
})

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PpobResultDialog open result={RESULT} autoPrint={false} onDone={() => {}} />
    </QueryClientProvider>,
  )
}

describe("PPOB result dialog", () => {
  it("prints the struk on Enter", async () => {
    renderDialog()
    await screen.findByRole("dialog")

    pressKey("Enter")

    await waitFor(() => expect(api.callsFor("POST /transactions/7/print")).toHaveLength(1))
  })

  // The scanner is a keyboard: the next item scanned before the dialog is
  // closed types digits and then Enter, which used to print another struk.
  it("does not print again when Enter ends a barcode scan", async () => {
    renderDialog()
    const dialog = await screen.findByRole("dialog")
    const target = document.activeElement ?? dialog

    const barcode = "8991234567890"
    const fireAt = (key: string, timeStamp: number) => {
      const event = createEvent.keyDown(target, { key })
      Object.defineProperty(event, "timeStamp", { value: timeStamp })
      fireEvent(target, event)
    }
    for (let index = 0; index < barcode.length; index++) {
      fireAt(barcode[index], 1000 + index * 10)
    }
    fireAt("Enter", 1000 + barcode.length * 10 + 20)

    expect(toast.warning).toHaveBeenCalledWith(id.cashier.scanIgnoredAfterSale)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(api.callsFor("POST /transactions/*/print")).toHaveLength(0)
  })
})

describe("PPOB result dialog after an ADVICE", () => {
  const ADVICE_LINE = {
    ...DETAIL.items[0],
    ppob_status: "uncertain",
    ppob_message: "Menunggu konfirmasi biller (ADVICE)",
    ppob_serial_number: null,
    ppob_advice: "{}",
  }

  it("reads as waiting on PLN, not as a rejection, and offers Cek status", async () => {
    api.route("GET /transactions/7", { ...DETAIL, items: [ADVICE_LINE] })
    api.route("POST /transaction-items/*/ppob/check", {
      status: "uncertain",
      message: "Belum ada hasil pasti: belum ada di riwayat Mitra. Coba cek lagi nanti.",
    })
    renderDialog()

    expect(await screen.findByText("Menunggu Konfirmasi PLN")).toBeInTheDocument()
    expect(screen.getByText("Menunggu konfirmasi PLN")).toBeInTheDocument()
    expect(screen.queryByText(id.ppobFulfillment.rejectedTitle)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Cek status/ }))
    await waitFor(() =>
      expect(api.lastCall("POST /transaction-items/*/ppob/check")?.path).toBe(
        "/transaction-items/11/ppob/check",
      ),
    )
  })
})

describe("PPOB result dialog auto-print", () => {
  const UNCERTAIN_LINE = {
    ...DETAIL.items[0],
    ppob_status: "uncertain",
    ppob_serial_number: null,
    ppob_advice: "{}",
  }

  function renderAutoPrinting() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <PpobResultDialog open result={RESULT} autoPrint onDone={() => {}} />
      </QueryClientProvider>,
    )
    return client
  }

  // A struk printed while the line is uncertain has no token on it. When the
  // line settles (Cek status, or here a refetch) it prints then, once.
  it("does not print an uncertain line, and prints once it turns success", async () => {
    api.route("GET /transactions/7", { ...DETAIL, items: [UNCERTAIN_LINE] })
    const client = renderAutoPrinting()

    expect(await screen.findByText("Menunggu Konfirmasi PLN")).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(api.callsFor("POST /transactions/*/print")).toHaveLength(0)

    api.route("GET /transactions/7", DETAIL)
    await client.invalidateQueries({ queryKey: ["transactions"] })

    expect(await screen.findByText("1111-2222-3333-4444")).toBeInTheDocument()
    await waitFor(() => expect(api.callsFor("POST /transactions/*/print")).toHaveLength(1))
  })

  it("prints a failed line straight away", async () => {
    api.route("GET /transactions/7", {
      ...DETAIL,
      items: [{ ...DETAIL.items[0], ppob_status: "failed", ppob_serial_number: null }],
    })
    renderAutoPrinting()

    await waitFor(() => expect(api.callsFor("POST /transactions/*/print")).toHaveLength(1))
  })
})

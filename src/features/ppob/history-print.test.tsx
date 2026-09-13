import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { I18nProvider } from "@heroui/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock("@/lib/toast", () => ({
  toast: {
    success: (message: string) => toastSuccess(message),
    error: (message: string) => toastError(message),
    warning: vi.fn(),
  },
}))

import { installApiMock, apiFailure, type ApiMock } from "@/test-utils/api-mock"
import { TransactionDetailDialog } from "./components/history/history-table"
import type { HistoryPaymentItem } from "./types"
import type { PpobMarkup } from "./types/auth"

/** A PLN postpaid row as `/ppob/history` answers it: `total` null, `amount`
 * the figure the outlet paid with the admin fee already in it. */
const PLN_ROW: HistoryPaymentItem = {
  trxId: "111100000001",
  inquiryId: null,
  productName: "-",
  description: "PLN - 231000000002",
  serialNumber: "",
  total: null,
  amount: 73229,
  adminFee: 3500,
  status: "SUKSES",
  createdAt: "2026-09-11 10:11:50",
  vendorPrice: null,
  basePrice: 69729,
  sellPrice: null,
  profit: null,
  margin: null,
  denom: null,
  provider: null,
  merchant: null,
  plu: "321700758",
  serviceType: "PLN",
  customerNo: "231000000002",
  tokenNumber: "",
  paymentCode: "L231000000002-2-260911101150",
  receiptText: "IDPEL          : 231000000002\r\nTOTAL BAYAR    : Rp 73.229,00\r\n",
  invoiceUrl: null,
  igrDesc: "Post paid",
  noRef: "13516345",
}

const MARKUP: PpobMarkup = {
  pulsa: { type: "fixed", value: 2000 },
  data: { type: "fixed", value: 2000 },
  pln: { type: "fixed", value: 1500 },
  pdam: { type: "fixed", value: 2500 },
  bpjs: { type: "fixed", value: 2500 },
  emoney: { type: "fixed", value: 1000 },
  custom_prices: {},
}

const onClose = vi.fn()

function renderDialog(item: HistoryPaymentItem | null = PLN_ROW) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <I18nProvider locale="id-ID">
      <QueryClientProvider client={client}>
        <TransactionDetailDialog item={item} onClose={onClose} />
      </QueryClientProvider>
    </I18nProvider>,
  )
}

function priceInput() {
  return screen.getByRole("textbox", { name: /Biaya Layanan/ })
}

function setPrice(value: string) {
  const input = priceInput()
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

let api: ApiMock

beforeEach(() => {
  toastSuccess.mockClear()
  onClose.mockClear()
  toastError.mockClear()
  api = installApiMock({
    "GET /settings/ppob/markup": MARKUP,
    "POST /ppob/history/*/print": null,
  })
})

describe("Cetak struk dari detail riwayat PPOB", () => {
  it("mengisi biaya layanan dari markup layanan di pengaturan PPOB", async () => {
    renderDialog()

    // Markup PLN 1.500 dari pengaturan, di atas modal 73.229.
    await waitFor(() => expect(priceInput()).toHaveValue("1.500"))
    expect(screen.getByText("Rp 73.229")).toBeInTheDocument()
    expect(screen.getByText("Rp 74.729")).toBeInTheDocument()
  })

  it("biaya layanan nol bila markup tidak ada", async () => {
    api.route("GET /settings/ppob/markup", apiFailure(403, "forbidden", "Tidak boleh"))
    renderDialog()

    await waitFor(() => expect(priceInput()).toHaveValue("0"))
    expect(screen.getAllByText("Rp 73.229")).toHaveLength(2)
  })

  it("menghitung grand total langsung dan menandai diskon", async () => {
    renderDialog()
    await waitFor(() => expect(priceInput()).toHaveValue("1.500"))

    setPrice("6771")
    expect(screen.getByText("Rp 80.000")).toBeInTheDocument()

    setPrice("-3229")
    expect(screen.getByText("Rp 70.000")).toHaveClass("text-danger")
  })

  it("mencetak dengan biaya layanan yang dipilih lalu menutup dialog", async () => {
    renderDialog()
    await waitFor(() => expect(priceInput()).toHaveValue("1.500"))
    setPrice("6771")

    fireEvent.click(screen.getByRole("button", { name: "Cetak Struk" }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Struk dicetak"))
    const call = api.lastCall("POST /ppob/history/*/print")
    expect(call?.path).toBe("/ppob/history/111100000001/print")
    expect(call?.body).toEqual({ sellPrice: 80000 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("melaporkan kegagalan cetak sebagai toast, bukan menutup dialog", async () => {
    api.route(
      "POST /ppob/history/*/print",
      apiFailure(422, "validation", "Printer belum dikonfigurasi"),
    )
    renderDialog()
    await waitFor(() => expect(priceInput()).toHaveValue("1.500"))

    fireEvent.click(screen.getByRole("button", { name: "Cetak Struk" }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Gagal cetak struk: Printer belum dikonfigurasi"),
    )
  })

  it("tidak bisa mencetak tanpa biaya layanan", async () => {
    renderDialog()
    await waitFor(() => expect(priceInput()).toHaveValue("1.500"))

    setPrice("")

    expect(screen.getByText("Grand Total").nextElementSibling).toHaveTextContent("-")
    expect(screen.getByRole("button", { name: "Cetak Struk" })).toBeDisabled()
  })
})

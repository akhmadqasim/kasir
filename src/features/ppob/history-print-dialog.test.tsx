import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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
import { HistoryPrintDialog } from "./components/history/history-print-dialog"
import type { HistoryPaymentItem, PpobReceiptLine } from "./types"
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

function receiptLines(sellPrice: number): PpobReceiptLine[] {
  return [
    { text: "          Toko Contoh           ", bold: false, size: "normal" },
    { text: "IDPEL          : 231000000002", bold: false, size: "normal" },
    { text: "Total             Rp 73.229", bold: false, size: "normal" },
    { text: `Grand Total       Rp ${sellPrice}`, bold: false, size: "normal" },
  ]
}

function renderDialog(item: HistoryPaymentItem | null = PLN_ROW) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <HistoryPrintDialog item={item} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

function priceInput() {
  return screen.getByRole("textbox", { name: /Harga Jual/ })
}

function setPrice(value: string) {
  const input = priceInput()
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

let api: ApiMock

beforeEach(() => {
  toastSuccess.mockClear()
  toastError.mockClear()
  api = installApiMock({
    "GET /settings/ppob/markup": MARKUP,
    "GET /ppob/history/*/receipt": (call) => receiptLines(Number(call.query.get("sellPrice"))),
    "POST /ppob/history/*/print": null,
  })
})

describe("HistoryPrintDialog", () => {
  it("mengisi harga jual dari markup layanan di pengaturan PPOB", async () => {
    renderDialog()

    // 73.229 modal + markup PLN 1.500 dari pengaturan.
    await waitFor(() => expect(priceInput()).toHaveValue("74729"))
    expect(screen.getByText("Rp 73.229")).toBeInTheDocument()
    expect(screen.getByText("+Rp 1.500")).toBeInTheDocument()
  })

  it("memakai harga modal sebagai harga jual bila markup tidak ada", async () => {
    api.route("GET /settings/ppob/markup", apiFailure(403, "forbidden", "Tidak boleh"))
    renderDialog()

    await waitFor(() => expect(priceInput()).toHaveValue("73229"))
    expect(screen.getByText("+Rp 0")).toBeInTheDocument()
  })

  it("menghitung keuntungan langsung dan menandai yang rugi", async () => {
    renderDialog()
    await waitFor(() => expect(priceInput()).toHaveValue("74729"))

    setPrice("80000")
    expect(screen.getByText("+Rp 6.771")).toHaveClass("text-success")

    setPrice("70000")
    expect(screen.getByText("-Rp 3.229")).toHaveClass("text-danger")
  })

  it("menampilkan pratinjau struk untuk harga jual yang dipilih", async () => {
    renderDialog()

    // Baris dari server, apa adanya — Grand Total mengikuti harga jual.
    expect(await screen.findByText(/Grand Total\s+Rp 74729/)).toBeInTheDocument()
    expect(api.lastCall("GET /ppob/history/*/receipt")?.query.get("sellPrice")).toBe("74729")

    setPrice("80000")
    expect(await screen.findByText(/Grand Total\s+Rp 80000/)).toBeInTheDocument()
  })

  it("mencetak dengan harga jual yang sedang dipilih dan membiarkan dialog terbuka", async () => {
    renderDialog()
    await waitFor(() => expect(priceInput()).toHaveValue("74729"))
    setPrice("80000")

    fireEvent.click(screen.getByRole("button", { name: "Cetak Struk" }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Struk dicetak"))
    const call = api.lastCall("POST /ppob/history/*/print")
    expect(call?.path).toBe("/ppob/history/111100000001/print")
    expect(call?.body).toEqual({ sellPrice: 80000 })
    // Masih terbuka untuk cetak ulang.
    expect(screen.getByRole("button", { name: "Cetak Struk" })).toBeInTheDocument()
  })

  it("melaporkan kegagalan cetak sebagai toast, bukan menutup dialog", async () => {
    api.route(
      "POST /ppob/history/*/print",
      apiFailure(422, "validation", "Printer belum dikonfigurasi"),
    )
    renderDialog()
    await waitFor(() => expect(priceInput()).toHaveValue("74729"))

    fireEvent.click(screen.getByRole("button", { name: "Cetak Struk" }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Gagal cetak struk: Printer belum dikonfigurasi"),
    )
  })

  it("tidak bisa mencetak tanpa harga jual", async () => {
    renderDialog()
    await waitFor(() => expect(priceInput()).toHaveValue("74729"))

    setPrice("")

    expect(screen.getByText("Keuntungan").nextElementSibling).toHaveTextContent("-")
    expect(screen.getByRole("button", { name: "Cetak Struk" })).toBeDisabled()
  })
})

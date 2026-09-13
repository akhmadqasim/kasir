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
import { PLN_ROW } from "./history-fixture"
import type { HistoryPaymentItem } from "./types"

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
    "POST /ppob/history/*/print": null,
  })
})

describe("Cetak struk dari detail riwayat PPOB", () => {
  it("biaya layanan mulai kosong dan grand total sama dengan modal", () => {
    renderDialog()

    expect(priceInput()).toHaveValue("")
    expect(priceInput()).toHaveAttribute("placeholder", "0")
    expect(screen.getAllByText("Rp 73.229")).toHaveLength(2)
  })

  it("menghitung grand total langsung dan menandai diskon", () => {
    renderDialog()

    setPrice("6771")
    expect(screen.getByText("Rp 80.000")).toBeInTheDocument()

    setPrice("-3229")
    expect(screen.getByText("Rp 70.000")).toHaveClass("text-danger")
  })

  it("mencetak dengan biaya layanan yang dipilih lalu menutup dialog", async () => {
    renderDialog()
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

    fireEvent.click(screen.getByRole("button", { name: "Cetak Struk" }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Gagal cetak struk: Printer belum dikonfigurasi"),
    )
  })

  it("tidak bisa mencetak dengan diskon di bawah modal", () => {
    renderDialog()

    setPrice("-80000")

    expect(screen.getByText("Grand Total").nextElementSibling).toHaveTextContent("-")
    expect(screen.getByRole("button", { name: "Cetak Struk" })).toBeDisabled()
  })
})

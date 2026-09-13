import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
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
import { SendWhatsappDialog } from "./components/send-whatsapp-dialog"

let api: ApiMock

function renderDialog(onOpenChange: (open: boolean) => void = () => {}) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SendWhatsappDialog isOpen transactionId={42} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  toastSuccess.mockClear()
  toastError.mockClear()
  sessionStorage.clear()
})

describe("dialog kirim struk via WhatsApp", () => {
  it("menolak mengirim tanpa nomor", async () => {
    api = installApiMock({})
    renderDialog()

    fireEvent.click(await screen.findByRole("button", { name: "Kirim" }))

    expect(toastError).toHaveBeenCalledWith("Nomor WhatsApp wajib diisi")
    expect(api.calls).toHaveLength(0)
  })

  it("mengirim struk lalu menutup dialog dan mengingat nomornya", async () => {
    api = installApiMock({ "POST /whatsapp/send-receipt": null })
    const onOpenChange = vi.fn()
    renderDialog(onOpenChange)

    fireEvent.change(screen.getByLabelText("Nomor WhatsApp"), {
      target: { value: "0812-3456-7890" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Kirim" }))

    await waitFor(() => {
      expect(api.lastCall("POST /whatsapp/send-receipt")?.body).toEqual({
        transaction_id: 42,
        phone: "0812-3456-7890",
      })
    })
    expect(toastSuccess).toHaveBeenCalledWith("Struk berhasil dikirim ke WhatsApp")
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(sessionStorage.getItem("kasir.whatsapp.lastPhone")).toBe("0812-3456-7890")
  })

  it("melaporkan kegagalan pengiriman tanpa menutup dialog", async () => {
    api = installApiMock({
      "POST /whatsapp/send-receipt": apiFailure(
        422,
        "validation",
        "Nomor ini tidak terdaftar di WhatsApp.",
      ),
    })
    const onOpenChange = vi.fn()
    renderDialog(onOpenChange)

    fireEvent.change(screen.getByLabelText("Nomor WhatsApp"), { target: { value: "0812345678" } })
    fireEvent.click(screen.getByRole("button", { name: "Kirim" }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "Gagal mengirim struk: Nomor ini tidak terdaftar di WhatsApp.",
      )
    })
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

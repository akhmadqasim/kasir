import type { ReactElement } from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import { installApiMock, installDeferredApiMock, type ApiMock } from "@/test-utils/api-mock"
import { WhatsappTab } from "./components/whatsapp-tab"

let api: ApiMock

function renderTab(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const OFF = { enabled: false, state: "off" }
const QR_PENDING = { enabled: true, state: "qr_pending", qr: "2@fake-qr-payload" }
const READY = { enabled: true, state: "ready", number: "6281234567890" }

describe("tab pengaturan WhatsApp", () => {
  it("menampilkan status Nonaktif dan mengaktifkan lewat saklar", async () => {
    api = installApiMock({
      "GET /whatsapp/status": OFF,
      "GET /whatsapp/settings": { caption_template: "Halo {store}" },
      "POST /whatsapp/enable": QR_PENDING,
    })
    renderTab(<WhatsappTab />)

    expect(await screen.findByText("Nonaktif")).toBeInTheDocument()
    const toggle = screen.getByRole("switch", { name: "Aktifkan WhatsApp" })
    expect(toggle).not.toBeChecked()

    fireEvent.click(toggle)

    await waitFor(() => expect(api.callsFor("POST /whatsapp/enable")).toHaveLength(1))
  })

  it("menampilkan kode QR saat menunggu pindai", async () => {
    api = installApiMock({
      "GET /whatsapp/status": QR_PENDING,
      "GET /whatsapp/settings": { caption_template: "Halo {store}" },
    })
    const { container } = renderTab(<WhatsappTab />)

    expect(await screen.findByText("Menunggu pindai QR")).toBeInTheDocument()
    expect(screen.getByText(/Perangkat Tertaut/)).toBeInTheDocument()
    expect(container.querySelector("svg")).not.toBeNull()
  })

  it("menampilkan nomor tertaut dan memutuskan lewat konfirmasi", async () => {
    api = installApiMock({
      "GET /whatsapp/status": READY,
      "GET /whatsapp/settings": { caption_template: "Halo {store}" },
      "POST /whatsapp/logout": null,
    })
    renderTab(<WhatsappTab />)

    expect(await screen.findByText("Terhubung")).toBeInTheDocument()
    expect(screen.getByText("6281234567890")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Putuskan" }))

    const dialog = await screen.findByRole("alertdialog")
    expect(api.callsFor("POST /whatsapp/logout")).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole("button", { name: "Ya, Putuskan" }))
    await waitFor(() => expect(api.callsFor("POST /whatsapp/logout")).toHaveLength(1))
  })

  it("mematikan tombol simpan sampai teks pengantar dimuat, lalu menyimpannya", async () => {
    const deferred = installDeferredApiMock(
      "GET /whatsapp/settings",
      { caption_template: "Halo {store}" },
      { "GET /whatsapp/status": OFF, "PUT /whatsapp/settings": null },
    )
    api = deferred.api
    renderTab(<WhatsappTab />)

    const save = screen.getByRole("button", { name: "Simpan" })
    expect(save).toBeDisabled()

    deferred.release()
    await waitFor(() => expect(save).toBeEnabled())

    fireEvent.click(save)
    await waitFor(() => {
      expect(api.lastCall("PUT /whatsapp/settings")?.body).toEqual({
        caption_template: "Halo {store}",
      })
    })
  })
})

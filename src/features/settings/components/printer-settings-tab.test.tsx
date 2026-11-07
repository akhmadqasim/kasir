import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { installApiMock } from "@/test-utils/api-mock"
import type { PrinterSettings } from "../types"

const SETTINGS: PrinterSettings = {
  printer_id: null,
  paper_width: 58,
  auto_print: false,
  footer_text: null,
  print_mode: "text",
}

async function renderWithUserAgent(userAgent: string) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent)
  vi.resetModules()
  const { PrinterSettingsTab } = await import("./printer-settings-tab")
  installApiMock({
    "GET /printers/settings": SETTINGS,
    "GET /printers": [],
  })
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <PrinterSettingsTab isAdmin={false} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("PrinterSettingsTab printer hint", () => {
  it("names Windows when the user agent is Windows", async () => {
    await renderWithUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    expect(
      await screen.findByText("Pastikan printer thermal sudah terhubung dan terpasang di Windows"),
    ).toBeTruthy()
  }, 15000)

  it("names USB and Bluetooth on Linux", async () => {
    await renderWithUserAgent("Mozilla/5.0 (X11; Linux x86_64)")
    expect(
      await screen.findByText(
        "Pastikan printer thermal sudah tersambung lewat USB, atau sudah dipasangkan lewat Bluetooth",
      ),
    ).toBeTruthy()
  }, 15000)
})

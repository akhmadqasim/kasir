import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { apiFailure, installApiMock } from "@/test-utils/api-mock"
import { ReceiptPreview } from "./components/receipt-preview"
import { receiptColumns } from "./utils/receipt-png"

function renderPreview(paperWidth?: number | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ReceiptPreview paperWidth={paperWidth} transactionId={7} />
    </QueryClientProvider>,
  )
}

describe("receiptColumns", () => {
  it("is 42 columns on 80 mm paper and 32 on anything else, like the backend", () => {
    expect(receiptColumns(80)).toBe(42)
    expect(receiptColumns(58)).toBe(32)
    expect(receiptColumns(null)).toBe(32)
    expect(receiptColumns(undefined)).toBe(32)
  })
})

describe("ReceiptPreview", () => {
  it("draws the printer's own lines, bold where the printer prints bold", async () => {
    installApiMock({
      "GET /transactions/7/receipt/lines": [
        { text: "TOKO BERKAH", bold: true, size: "normal" },
        { text: "Gula 1kg 2 x 16.000", bold: false, size: "normal" },
        { text: "TOTAL 32.000", bold: true, size: "normal" },
      ],
    })
    renderPreview(58)

    const total = await screen.findByText("TOTAL 32.000")
    expect(total).toHaveClass("font-bold")
    expect(screen.getByText("Gula 1kg 2 x 16.000")).not.toHaveClass("font-bold")
  })

  it("asks for the paper width the printer is set to", async () => {
    const api = installApiMock({ "GET /transactions/7/receipt/lines": [] })
    renderPreview(80)

    await vi.waitFor(() =>
      expect(api.lastCall("GET /transactions/7/receipt/lines")?.query.get("paper")).toBe("80"),
    )
  })

  it("leaves the paper width to the backend while the printer setting is unknown", async () => {
    const api = installApiMock({ "GET /transactions/7/receipt/lines": [] })
    renderPreview(null)

    await vi.waitFor(() => expect(api.calls).toHaveLength(1))
    expect(api.calls[0].query.has("paper")).toBe(false)
  })

  it("shows a load error with a retry instead of an endless skeleton", async () => {
    installApiMock({
      "GET /transactions/7/receipt/lines": apiFailure(500, "internal", "Printer belum diatur"),
    })
    renderPreview(58)

    expect(await screen.findByText("Printer belum diatur")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Coba lagi/i })).toBeInTheDocument()
  })
})

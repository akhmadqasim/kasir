import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { apiFailure, installApiMock } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import { PpFlow } from "./components/pp-flow"

const GROUPS = [
  { id: 33, group: "Internet & TV", imageUrl: null, pathIcon: null },
  { id: 6, group: "Multi Finance", imageUrl: null, pathIcon: null },
]

const INTERNET_TV_SUB_MENU = [
  {
    id: 354,
    paymentPointGroupId: 33,
    plu: "121900061",
    igrPlu: "1690820",
    merchant: "Indihome",
    description: "Telkom Indihome",
    inputAmt: 0,
    isTrouble: 0,
    label: "Kode Pembayaran",
    pathIcon: null,
  },
  {
    id: 999,
    paymentPointGroupId: 33,
    plu: "123999999",
    igrPlu: "1699999",
    merchant: "Jaringan Bermasalah",
    description: "Sedang gangguan",
    inputAmt: 0,
    isTrouble: 1,
    label: "Kode Pembayaran",
    pathIcon: null,
  },
  {
    id: 42,
    paymentPointGroupId: 33,
    plu: "123000042",
    igrPlu: "1600042",
    merchant: "Griya Voucher",
    description: "Voucher game",
    inputAmt: 1,
    isTrouble: 0,
    label: "Kode Voucher",
    pathIcon: null,
  },
]

function renderFlow(initialEntry: string | { pathname: string; state?: unknown } = "/ppob/pp") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <TestNavbar>
          <Routes>
            <Route path="/ppob/pp" element={<PpFlow />} />
          </Routes>
        </TestNavbar>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("payment point flow", () => {
  it("shows groups as tiles and opens the merchant step for one", async () => {
    installApiMock({
      "GET /ppob/menu": GROUPS,
      "GET /ppob/catalog/payment-points/*/sub-menu": INTERNET_TV_SUB_MENU,
    })
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))

    expect(await screen.findByRole("button", { name: /Indihome/ })).toBeInTheDocument()
  })

  it("jumps back to the group step from the breadcrumb", async () => {
    installApiMock({
      "GET /ppob/menu": GROUPS,
      "GET /ppob/catalog/payment-points/*/sub-menu": INTERNET_TV_SUB_MENU,
    })
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Indihome/ }))
    expect(await screen.findByLabelText("Kode Pembayaran")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Payment Point"))

    expect(await screen.findByRole("button", { name: "Internet & TV" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Kode Pembayaran")).toBeNull()
  })

  it("marks a biller in trouble as disabled and unselectable", async () => {
    installApiMock({
      "GET /ppob/menu": GROUPS,
      "GET /ppob/catalog/payment-points/*/sub-menu": INTERNET_TV_SUB_MENU,
    })
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    const troubled = await screen.findByRole("button", { name: /Jaringan Bermasalah/ })

    expect(troubled).toBeDisabled()
    expect(screen.getByText("Gangguan")).toBeInTheDocument()

    fireEvent.click(troubled)
    // Still on the merchant step — a disabled tile does not advance the flow.
    expect(screen.queryByLabelText("Kode Pembayaran")).toBeNull()
  })

  it("labels the payment code field from the biller's own label", async () => {
    installApiMock({
      "GET /ppob/menu": GROUPS,
      "GET /ppob/catalog/payment-points/*/sub-menu": INTERNET_TV_SUB_MENU,
    })
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Griya Voucher/ }))

    expect(await screen.findByLabelText("Kode Voucher")).toBeInTheDocument()
  })

  it("shows a nominal field when the biller requires one, and includes it in the summary", async () => {
    installApiMock({
      "GET /ppob/menu": GROUPS,
      "GET /ppob/catalog/payment-points/*/sub-menu": INTERNET_TV_SUB_MENU,
    })
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Griya Voucher/ }))

    const nominalField = await screen.findByLabelText("Nominal")
    fireEvent.change(await screen.findByLabelText("Kode Voucher"), {
      target: { value: "VC123456" },
    })
    fireEvent.change(nominalField, { target: { value: "50000" } })

    expect(await screen.findByText("Rp 50.000")).toBeInTheDocument()
  })

  it("preselects the group and biller a search result was opened from", async () => {
    installApiMock({
      "GET /ppob/menu": GROUPS,
      "GET /ppob/catalog/payment-points/*/sub-menu": INTERNET_TV_SUB_MENU,
    })
    renderFlow({
      pathname: "/ppob/pp",
      state: { preselectGroup: { id: 33, name: "Internet & TV" }, preselectItemId: 354 },
    })

    // Straight to the payment-code step — no group or merchant tile to tap.
    expect(await screen.findByLabelText("Kode Pembayaran")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: "Indihome" })).toBeInTheDocument()
  })

  it("shows an alert when the biller list fails to load", async () => {
    installApiMock({
      "GET /ppob/menu": GROUPS,
      "GET /ppob/catalog/payment-points/*/sub-menu": apiFailure(
        500,
        "internal",
        "Server PPOB sedang gangguan",
      ),
    })
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))

    expect(await screen.findByText("Server PPOB sedang gangguan")).toBeInTheDocument()
  })
})

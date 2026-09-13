import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const toastError = vi.fn()
vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: (message: string) => toastError(message),
    warning: vi.fn(),
  },
}))

import { apiFailure, installApiMock, type ApiRoutes } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import { useCartStore } from "@/stores/cart-store"
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

/** Every route the flow needs before an inquiry is even attempted. */
function basePpRoutes(overrides: ApiRoutes = {}): ApiRoutes {
  return {
    "GET /ppob/menu": GROUPS,
    "GET /ppob/catalog/payment-points/*/sub-menu": INTERNET_TV_SUB_MENU,
    "GET /settings/ppob/markup": {},
    ...overrides,
  }
}

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

beforeEach(() => {
  toastError.mockClear()
  useCartStore.setState({
    items: [],
    heldCarts: [],
    itemDiscounts: {},
    transactionDiscount: null,
    ppobCounter: 0,
  })
})

describe("payment point flow", () => {
  it("shows groups as tiles and opens the merchant step for one", async () => {
    installApiMock(basePpRoutes())
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))

    expect(await screen.findByRole("button", { name: /Indihome/ })).toBeInTheDocument()
  })

  it("jumps back to the group step from the breadcrumb", async () => {
    installApiMock(basePpRoutes())
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Indihome/ }))
    expect(await screen.findByLabelText("Kode Pembayaran")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Payment Point"))

    expect(await screen.findByRole("button", { name: "Internet & TV" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Kode Pembayaran")).toBeNull()
  })

  it("marks a biller in trouble as disabled and unselectable", async () => {
    installApiMock(basePpRoutes())
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
    installApiMock(basePpRoutes())
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Griya Voucher/ }))

    expect(await screen.findByLabelText("Kode Voucher")).toBeInTheDocument()
  })

  it("preselects the group and biller a search result was opened from", async () => {
    installApiMock(basePpRoutes())
    renderFlow({
      pathname: "/ppob/pp",
      state: { preselectGroup: { id: 33, name: "Internet & TV" }, preselectItemId: 354 },
    })

    // Straight to the payment-code step — no group or merchant tile to tap.
    expect(await screen.findByLabelText("Kode Pembayaran")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: "Indihome" })).toBeInTheDocument()
  })

  it("shows an alert when the biller list fails to load", async () => {
    installApiMock(
      basePpRoutes({
        "GET /ppob/catalog/payment-points/*/sub-menu": apiFailure(
          500,
          "internal",
          "Server PPOB sedang gangguan",
        ),
      }),
    )
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))

    expect(await screen.findByText("Server PPOB sedang gangguan")).toBeInTheDocument()
  })

  it("checks the bill, sending the biller's plu and the typed customer id as the inquiry", async () => {
    const api = installApiMock(
      basePpRoutes({
        "POST /ppob/inquiries/pp": {
          inquiryId: "INQ-1",
          customerName: "BUDI SANTOSO",
          customerId: "1234567890",
          productName: null,
          amount: 300000,
          adminFee: 2500,
          total: 302500,
          serviceType: "pp",
          rawData: {},
        },
      }),
    )
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Indihome/ }))
    fireEvent.change(await screen.findByLabelText("Kode Pembayaran"), {
      target: { value: "1234567890" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Cek Tagihan" }))

    expect(await screen.findByText("BUDI SANTOSO")).toBeInTheDocument()
    expect(screen.getByText("Rp 300.000")).toBeInTheDocument()
    expect(screen.getByText("Rp 2.500")).toBeInTheDocument()
    expect(screen.getByText("Rp 302.500")).toBeInTheDocument()

    const call = api.lastCall("POST /ppob/inquiries/pp")
    expect(call?.body).toEqual({
      customerId: "1234567890",
      paymentPointGroupId: 33,
      productCode: "121900061",
    })
  })

  it("shows the billing period when the vendor's response carries one", async () => {
    installApiMock(
      basePpRoutes({
        "POST /ppob/inquiries/pp": {
          inquiryId: "INQ-1",
          customerName: "BUDI SANTOSO",
          customerId: "1234567890",
          productName: null,
          amount: 300000,
          adminFee: 2500,
          total: 302500,
          serviceType: "pp",
          rawData: { period: "202609" },
        },
      }),
    )
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Indihome/ }))
    fireEvent.change(await screen.findByLabelText("Kode Pembayaran"), {
      target: { value: "1234567890" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Cek Tagihan" }))

    await screen.findByText("BUDI SANTOSO")
    expect(screen.getByText("Periode")).toBeInTheDocument()
    expect(screen.getByText("202609")).toBeInTheDocument()
  })

  it("does not show a period row when the vendor's response carries none", async () => {
    installApiMock(
      basePpRoutes({
        "POST /ppob/inquiries/pp": {
          inquiryId: "INQ-1",
          customerName: "BUDI SANTOSO",
          customerId: "1234567890",
          productName: null,
          amount: 300000,
          adminFee: 2500,
          total: 302500,
          serviceType: "pp",
          rawData: {},
        },
      }),
    )
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Indihome/ }))
    fireEvent.change(await screen.findByLabelText("Kode Pembayaran"), {
      target: { value: "1234567890" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Cek Tagihan" }))

    await screen.findByText("BUDI SANTOSO")
    expect(screen.queryByText("Periode")).toBeNull()
  })

  it("sends the typed nominal on inquiry for an input-amount biller, and shows it in the summary", async () => {
    const api = installApiMock(
      basePpRoutes({
        "POST /ppob/inquiries/pp": {
          inquiryId: "INQ-2",
          customerName: null,
          customerId: "VC123456",
          productName: null,
          amount: 50000,
          adminFee: 1500,
          total: 51500,
          serviceType: "pp",
          rawData: {},
        },
      }),
    )
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Griya Voucher/ }))

    fireEvent.change(await screen.findByLabelText("Kode Voucher"), {
      target: { value: "VC123456" },
    })
    fireEvent.change(await screen.findByLabelText("Nominal"), { target: { value: "50000" } })
    fireEvent.click(screen.getByRole("button", { name: "Cek Tagihan" }))

    expect(await screen.findByText("Rp 50.000")).toBeInTheDocument()
    expect(screen.getByText("Rp 1.500")).toBeInTheDocument()
    expect(screen.getByText("Rp 51.500")).toBeInTheDocument()

    const call = api.lastCall("POST /ppob/inquiries/pp")
    expect(call?.body).toEqual({
      customerId: "VC123456",
      paymentPointGroupId: 33,
      productCode: "123000042",
      amount: 50000,
    })
  })

  it("adds a payment-point line to the cart, shaped like the other services, when confirmed", async () => {
    installApiMock(
      basePpRoutes({
        "POST /ppob/inquiries/pp": {
          inquiryId: "INQ-1",
          customerName: "BUDI SANTOSO",
          customerId: "1234567890",
          productName: null,
          amount: 300000,
          adminFee: 2500,
          total: 302500,
          serviceType: "pp",
          rawData: {},
        },
      }),
    )
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Indihome/ }))
    fireEvent.change(await screen.findByLabelText("Kode Pembayaran"), {
      target: { value: "1234567890" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Cek Tagihan" }))
    await screen.findByText("BUDI SANTOSO")

    fireEvent.click(screen.getByRole("button", { name: "Tambah ke Keranjang" }))

    await waitFor(() => expect(useCartStore.getState().items).toHaveLength(1))
    const [item] = useCartStore.getState().items
    expect(item).toMatchObject({
      product_name: "Indihome - 1234567890",
      is_ppob: true,
      service_type: "pp",
      service_ref: "1234567890",
      buy_price: 302500,
      sell_price: 302500,
      ppob_product_code: "121900061",
      ppob_inquiry_id: "INQ-1",
    })
  })

  it("shows a toast with the upstream message when the inquiry fails", async () => {
    installApiMock(
      basePpRoutes({
        "POST /ppob/inquiries/pp": apiFailure(422, "validation", "ID pelanggan tidak ditemukan"),
      }),
    )
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Indihome/ }))
    fireEvent.change(await screen.findByLabelText("Kode Pembayaran"), {
      target: { value: "1234567890" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Cek Tagihan" }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.stringContaining("ID pelanggan tidak ditemukan"),
      ),
    )
    // Still on the input step — a failed inquiry does not fabricate a summary.
    expect(screen.queryByRole("button", { name: "Tambah ke Keranjang" })).toBeNull()
  })

  it("disables Cek Tagihan until a payment code is typed", async () => {
    installApiMock(basePpRoutes())
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Indihome/ }))

    expect(await screen.findByRole("button", { name: "Cek Tagihan" })).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Kode Pembayaran"), { target: { value: "123" } })
    expect(screen.getByRole("button", { name: "Cek Tagihan" })).toBeEnabled()
  })

  it("treats a payment code of only spaces as not ready either", async () => {
    installApiMock(basePpRoutes())
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Indihome/ }))

    fireEvent.change(screen.getByLabelText("Kode Pembayaran"), { target: { value: "   " } })
    expect(screen.getByRole("button", { name: "Cek Tagihan" })).toBeDisabled()
  })

  it("requires the input-amount nominal before Cek Tagihan is enabled", async () => {
    installApiMock(basePpRoutes())
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Griya Voucher/ }))

    fireEvent.change(await screen.findByLabelText("Kode Voucher"), {
      target: { value: "VC123456" },
    })
    // Kode saja belum cukup untuk biller `inputAmt` — nominalnya juga wajib diisi.
    expect(screen.getByRole("button", { name: "Cek Tagihan" })).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Nominal"), { target: { value: "50000" } })
    expect(screen.getByRole("button", { name: "Cek Tagihan" })).toBeEnabled()
  })

  it("trims surrounding whitespace from the payment code before inquiring", async () => {
    const api = installApiMock(
      basePpRoutes({
        "POST /ppob/inquiries/pp": {
          inquiryId: "INQ-3",
          customerName: "BUDI SANTOSO",
          customerId: "1234567890",
          productName: null,
          amount: 300000,
          adminFee: 2500,
          total: 302500,
          serviceType: "pp",
          rawData: {},
        },
      }),
    )
    renderFlow()

    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Indihome/ }))
    fireEvent.change(await screen.findByLabelText("Kode Pembayaran"), {
      target: { value: "  1234567890  " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Cek Tagihan" }))

    await screen.findByText("BUDI SANTOSO")
    const call = api.lastCall("POST /ppob/inquiries/pp")
    expect(call?.body).toMatchObject({ customerId: "1234567890" })
  })
})

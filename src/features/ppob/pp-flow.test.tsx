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
import type { User } from "@/features/auth/types"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { Shift } from "@/features/shift/types"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useCartStore } from "@/stores/cart-store"
import { PpFlow } from "./components/pp-flow"
import { PPOB_MARKUP_STORAGE_KEY } from "./hooks/use-ppob-markup"

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

const KASIR: User = {
  id: 2,
  username: "kasir",
  full_name: "Kasir Toko",
  role: "kasir",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

const SHIFT: Shift = {
  id: 7,
  userId: 2,
  userName: "Kasir Toko",
  openingCash: 100_000,
  closingCash: null,
  openedAt: "2026-09-19 01:00:00",
  closedAt: null,
  notes: null,
  status: "open",
}

/** Every route the flow needs before an inquiry is even attempted. */
function basePpRoutes(overrides: ApiRoutes = {}): ApiRoutes {
  return {
    "GET /ppob/menu": GROUPS,
    "GET /ppob/catalog/payment-points/*/sub-menu": INTERNET_TV_SUB_MENU,
    "GET /settings/ppob/markup": {},
    // The page pays on the spot, so it also needs the shift and the printer.
    "GET /shifts/active": SHIFT,
    "GET /printers/settings": {
      printer_id: null,
      paper_width: null,
      auto_print: false,
      footer_text: null,
      print_mode: null,
    },
    ...overrides,
  }
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderFlow(
  initialEntry: string | { pathname: string; state?: unknown } = "/ppob/pp",
  client = newClient(),
) {
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
  // Paying needs a session and an open shift, like at the till.
  useAuthStore.setState({ user: KASIR })
  useShiftStore.setState({ activeShift: SHIFT })
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

  it("pays a payment-point line on the spot, in the ppob channel, shaped like the other services", async () => {
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
        "POST /transactions": (call) => {
          const body = call.body as { items: Record<string, unknown>[] }
          return {
            transaction: {
              id: 1,
              receipt_number: "TRX-20260919-0001",
              user_id: 2,
              total_amount: 302500,
              subtotal_amount: 302500,
              discount_amount: 0,
              payment_method: "cash",
              payment_amount: 302500,
              change_amount: 0,
              status: "completed",
              channel: "ppob",
              notes: null,
              deleted_at: null,
              deleted_by: null,
              deleted_reason: null,
              updated_at: null,
              created_at: "2026-09-19 02:00:00",
            },
            items: body.items.map((item, index) => ({
              ...item,
              id: index + 1,
              transaction_id: 1,
              product_id: null,
              subtotal: 302500,
              item_discount: 0,
              net_subtotal: 302500,
              ppob_status: "pending",
              ppob_message: null,
              ppob_serial_number: null,
              created_at: "2026-09-19 02:00:00",
            })),
            payment_breakdown: [{ payment_method: "cash", bank_name: null, amount: 302500 }],
          }
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

    expect(screen.queryByRole("button", { name: "Tambah ke Keranjang" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Bayar" }))

    // The payment dialog opens right here, on the PPOB page.
    await screen.findByRole("dialog", { name: "Pembayaran" })
    fireEvent.change(await screen.findByLabelText("Nominal Tunai"), {
      target: { value: "302500" },
    })
    const pinField = await screen.findByLabelText("PIN Mitra")
    fireEvent.change(pinField, { target: { value: "123456" } })
    fireEvent.keyDown(pinField, { key: "Enter" })

    await waitFor(() => expect(api.lastCall("POST /transactions")).toBeDefined())
    expect(api.lastCall("POST /transactions")?.body).toMatchObject({
      channel: "ppob",
      items: [
        {
          product_name: "Indihome - 1234567890",
          product_price: 302500,
          buy_price: 302500,
          service_type: "pp",
          service_ref: "1234567890",
          ppob_product_code: "121900061",
          ppob_inquiry_id: "INQ-1",
        },
      ],
    })
    // Nothing went through the cashier's cart.
    expect(useCartStore.getState().items).toHaveLength(0)
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

describe("payment point flow — markup", () => {
  const INQUIRY = {
    inquiryId: "INQ-1",
    customerName: "BUDI SANTOSO",
    customerId: "1234567890",
    productName: null,
    amount: 300000,
    adminFee: 2500,
    total: 302500,
    serviceType: "pp",
    rawData: {},
  }

  beforeEach(() => {
    localStorage.clear()
  })

  async function reachConfirmation() {
    fireEvent.click(await screen.findByRole("button", { name: "Internet & TV" }))
    fireEvent.click(await screen.findByRole("button", { name: /Indihome/ }))
    fireEvent.change(await screen.findByLabelText("Kode Pembayaran"), {
      target: { value: "1234567890" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Cek Tagihan" }))
    await screen.findByText("BUDI SANTOSO")
  }

  async function expectPayOpensDialog() {
    const pay = screen.getByRole("button", { name: "Bayar" })
    expect(pay).toBeEnabled()
    fireEvent.click(pay)
    expect(await screen.findByRole("dialog", { name: "Pembayaran" })).toBeInTheDocument()
  }

  it("prices with the loaded markup and remembers it for next time", async () => {
    installApiMock(
      basePpRoutes({
        "GET /settings/ppob/markup": { pp: { type: "fixed", value: 2000 } },
        "POST /ppob/inquiries/pp": INQUIRY,
      }),
    )
    renderFlow()
    await reachConfirmation()

    expect(await screen.findByText("Rp 304.500")).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(PPOB_MARKUP_STORAGE_KEY) ?? "null")).toEqual({
      pp: { type: "fixed", value: 2000 },
    })
    await expectPayOpensDialog()
  })

  it("uses the cached markup while the request is in flight, and lets the cashier pay", async () => {
    localStorage.setItem(
      PPOB_MARKUP_STORAGE_KEY,
      JSON.stringify({ pp: { type: "fixed", value: 2000 } }),
    )
    installApiMock(
      basePpRoutes({
        // Never answers: the markup stays in flight for the whole test.
        "GET /settings/ppob/markup": () => new Promise(() => {}),
        "POST /ppob/inquiries/pp": INQUIRY,
      }),
    )
    renderFlow()
    await reachConfirmation()

    expect(screen.getByText("Rp 304.500")).toBeInTheDocument()
    await expectPayOpensDialog()
  })

  it("toasts a failure, keeps the cached markup, and lets the cashier pay", async () => {
    localStorage.setItem(
      PPOB_MARKUP_STORAGE_KEY,
      JSON.stringify({ pp: { type: "fixed", value: 2000 } }),
    )
    installApiMock(
      basePpRoutes({
        "GET /settings/ppob/markup": apiFailure(500, "internal", "db error"),
        "POST /ppob/inquiries/pp": INQUIRY,
      }),
    )
    renderFlow()

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Gagal memuat markup PPOB, memakai markup terakhir"),
    )
    expect(toastError).toHaveBeenCalledTimes(1)

    await reachConfirmation()
    expect(screen.getByText("Rp 304.500")).toBeInTheDocument()
    await expectPayOpensDialog()
  })

  /** Every PPOB screen mounts the markup hook; a failure used to toast on each one. */
  it("toasts a failure once, however often the screen is remounted", async () => {
    const api = installApiMock(
      basePpRoutes({ "GET /settings/ppob/markup": apiFailure(500, "internal", "db error") }),
    )
    const client = newClient()

    const first = renderFlow("/ppob/pp", client)
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    first.unmount()

    // Remounting refetches the query in error, and that refetch fails too.
    renderFlow("/ppob/pp", client)
    await waitFor(() => expect(api.callsFor("GET /settings/ppob/markup")).toHaveLength(2))
    await screen.findByRole("button", { name: "Internet & TV" })

    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it("still lets the cashier pay when the markup fails and nothing is cached", async () => {
    installApiMock(
      basePpRoutes({
        "GET /settings/ppob/markup": apiFailure(500, "internal", "db error"),
        "POST /ppob/inquiries/pp": INQUIRY,
      }),
    )
    renderFlow()
    await reachConfirmation()

    // No markup ever loaded on this terminal: the configured zero default applies.
    expect(screen.getByText("Rp 302.500")).toBeInTheDocument()
    await expectPayOpensDialog()
  })
})

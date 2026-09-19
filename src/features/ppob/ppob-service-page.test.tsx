import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { TestNavbar } from "@/test-utils/test-navbar"
import type { User } from "@/features/auth/types"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { Shift } from "@/features/shift/types"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import type { Transaction, TransactionItem, TransactionResult } from "@/features/cashier/types"
import type { TransactionDetail } from "@/features/transactions/types"
import { useCartStore } from "@/stores/cart-store"
import { PpobServicePage } from "./components/ppob-service-page"

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
  userId: KASIR.id,
  userName: KASIR.full_name,
  openingCash: 100_000,
  closingCash: null,
  openedAt: "2026-09-19 01:00:00",
  closedAt: null,
  notes: null,
  status: "open",
}

const PLN_DENOMS = [
  { id: 1, denom: "20000" },
  { id: 2, denom: "50000" },
]

/** The provider's answer to "what does this meter owe?" — token price plus admin. */
const PLN_INQUIRY = {
  inquiryId: "INQ-PLN-1",
  customerName: "BUDI SANTOSO",
  customerId: "12345678901",
  productName: null,
  amount: 50_000,
  adminFee: 2_500,
  total: 52_500,
  serviceType: "pln",
  rawData: {},
}

function plnLine(status: string, serial: string | null): TransactionItem {
  return {
    id: 11,
    transaction_id: 1,
    product_id: null,
    product_name: "PLN Token Rp 50.000 - BUDI SANTOSO",
    product_price: 52_500,
    buy_price: 52_500,
    quantity: 1,
    subtotal: 52_500,
    item_discount: 0,
    net_subtotal: 52_500,
    service_type: "pln",
    service_ref: "12345678901",
    ppob_product_id: null,
    ppob_product_code: null,
    ppob_inquiry_id: "INQ-PLN-1",
    ppob_payment_code: "12345678901",
    ppob_flag_id: "0",
    ppob_status: status,
    ppob_message: null,
    ppob_serial_number: serial,
    created_at: "2026-09-19 02:00:00",
  }
}

const TRANSACTION: Transaction = {
  id: 1,
  receipt_number: "TRX-20260919-0001",
  user_id: KASIR.id,
  total_amount: 52_500,
  subtotal_amount: 52_500,
  discount_amount: 0,
  payment_method: "cash",
  payment_amount: 60_000,
  change_amount: 7_500,
  status: "completed",
  channel: "ppob",
  notes: null,
  deleted_at: null,
  deleted_by: null,
  deleted_reason: null,
  updated_at: null,
  created_at: "2026-09-19 02:00:00",
}

/** What checkout answers straight away: the line is still with the provider. */
const CHECKOUT_RESULT: TransactionResult = {
  transaction: TRANSACTION,
  items: [plnLine("pending", null)],
  payment_breakdown: [{ payment_method: "cash", bank_name: null, amount: 60_000 }],
}

/** What the detail says once the background fulfilment has reported back. */
const FULFILLED_DETAIL: TransactionDetail = {
  transaction: TRANSACTION,
  items: [plnLine("success", "1234-5678-9012-3456-7890")],
  cashier_name: KASIR.full_name,
  has_ppob: true,
  ppob_status: "success",
  ppob_message: null,
  ppob_serial_number: "1234-5678-9012-3456-7890",
  payment_breakdown: [{ payment_method: "cash", bank_name: null, amount: 60_000 }],
}

function renderPlnPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/ppob/pln"]}>
        <TestNavbar>
          <Routes>
            <Route path="/ppob/pln" element={<PpobServicePage service="pln" />} />
            <Route path="/ppob" element={<p>beranda ppob</p>} />
            <Route path="/cashier" element={<p>halaman kasir</p>} />
          </Routes>
        </TestNavbar>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let api: ApiMock

beforeEach(() => {
  api = installApiMock({
    "GET /ppob/catalog/pln/denominations": PLN_DENOMS,
    "GET /settings/ppob/markup": {},
    "POST /ppob/inquiries/pln": PLN_INQUIRY,
    "GET /shifts/active": SHIFT,
    "GET /printers/settings": {
      printer_id: null,
      paper_width: null,
      auto_print: false,
      footer_text: null,
      print_mode: null,
    },
    "POST /transactions": CHECKOUT_RESULT,
    "GET /transactions/*": FULFILLED_DETAIL,
  })
  useAuthStore.setState({ user: KASIR })
  useShiftStore.setState({ activeShift: SHIFT })
  useCartStore.setState({
    items: [],
    heldCarts: [],
    itemDiscounts: {},
    transactionDiscount: null,
    ppobCounter: 0,
    checkoutKey: null,
  })
})

/** Inquiry → Bayar: the steps every test below starts with. */
async function inquireAndPay() {
  fireEvent.change(await screen.findByRole("textbox", { name: "No. Meter / IDPEL" }), {
    target: { value: "12345678901" },
  })
  fireEvent.click(await screen.findByRole("button", { name: /50\.000/ }))
  fireEvent.click(await screen.findByRole("button", { name: "Cek Info Pelanggan" }))
  await screen.findByText("BUDI SANTOSO")

  fireEvent.click(screen.getByRole("button", { name: "Bayar" }))
}

/**
 * A purchase made on the PPOB page is paid on the PPOB page. It used to be
 * dropped into the cashier's cart and the cashier was sent to the sales
 * screen to finish it there — with the inquiry expiring on the way.
 */
describe("ppob service page", () => {
  it("offers to pay, not to add to the cart", async () => {
    renderPlnPage()

    fireEvent.change(await screen.findByRole("textbox", { name: "No. Meter / IDPEL" }), {
      target: { value: "12345678901" },
    })
    fireEvent.click(await screen.findByRole("button", { name: /50\.000/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Cek Info Pelanggan" }))
    await screen.findByText("BUDI SANTOSO")

    expect(screen.getByRole("button", { name: "Bayar" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Tambah ke Keranjang" })).not.toBeInTheDocument()
  })

  it("rings the purchase up in the ppob channel and never touches the cart", async () => {
    renderPlnPage()
    await inquireAndPay()

    const dialog = await screen.findByRole("dialog", { name: "Pembayaran" })
    expect(dialog).toBeInTheDocument()

    fireEvent.change(await screen.findByLabelText("Nominal Tunai"), {
      target: { value: "60000" },
    })
    const pinField = await screen.findByLabelText("PIN Mitra")
    fireEvent.change(pinField, { target: { value: "123456" } })
    fireEvent.keyDown(pinField, { key: "Enter" })

    await waitFor(() => expect(api.lastCall("POST /transactions")).toBeDefined())
    const checkout = api.lastCall("POST /transactions")
    expect(checkout?.headers.get("Idempotency-Key")).toBeTruthy()
    expect(checkout?.body).toMatchObject({
      channel: "ppob",
      payment_method: "cash",
      payment_amount: 60_000,
      shift_id: SHIFT.id,
      ppob_pin: "123456",
      items: [
        {
          quantity: 1,
          // `Intl` puts a non-breaking space after "Rp".
          product_name: expect.stringMatching(/^PLN Token Rp\s50\.000 - BUDI SANTOSO$/),
          product_price: 52_500,
          buy_price: 52_500,
          service_type: "pln",
          service_ref: "12345678901",
          ppob_inquiry_id: "INQ-PLN-1",
          ppob_payment_code: "12345678901",
          ppob_flag_id: "0",
        },
      ],
    })
    expect(useCartStore.getState().items).toHaveLength(0)
  })

  it("shows the token once the provider has answered, then goes home — not to the till", async () => {
    renderPlnPage()
    await inquireAndPay()

    fireEvent.change(await screen.findByLabelText("Nominal Tunai"), {
      target: { value: "60000" },
    })
    const pinField = await screen.findByLabelText("PIN Mitra")
    fireEvent.change(pinField, { target: { value: "123456" } })
    fireEvent.keyDown(pinField, { key: "Enter" })

    const result = await screen.findByRole("dialog", { name: "Transaksi PPOB selesai" })
    // Change first — that is what is handed over now.
    expect(screen.getByText("Rp 7.500")).toBeInTheDocument()
    // The detail is polled until the line is final; the token comes from it.
    expect(await screen.findByText("1234-5678-9012-3456-7890")).toBeInTheDocument()
    expect(screen.getByText("Berhasil")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Selesai/ }))

    expect(await screen.findByText("beranda ppob")).toBeInTheDocument()
    expect(result).not.toBeInTheDocument()
    expect(screen.queryByText("halaman kasir")).not.toBeInTheDocument()
  })

  it("asks for a shift first when none is open, instead of booking a sale outside one", async () => {
    api.route("GET /shifts/active", null)
    useShiftStore.setState({ activeShift: null })
    renderPlnPage()
    await inquireAndPay()

    expect(await screen.findByRole("dialog", { name: "Buka Kasir" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Pembayaran" })).not.toBeInTheDocument()
    expect(api.callsFor("POST /transactions")).toHaveLength(0)
  })
})

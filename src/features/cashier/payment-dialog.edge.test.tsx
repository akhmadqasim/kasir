import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import { SETTINGS } from "@/test-utils/settings-fixture"
import type { User } from "@/features/auth/types"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useCartStore } from "@/stores/cart-store"
import { PaymentDialog } from "./components/payment/payment-dialog"
import type { CartItem, CheckoutTransactionInput, TransactionResult } from "./types"
import { formatRupiah } from "./utils"

/**
 * The payment dialog's money: quick amounts, Uang Pas from its button and its
 * two keys, change, split payments and the discounts the cart hands over.
 */

const KASIR: User = {
  id: 2,
  username: "kasir01",
  full_name: "Kasir Satu",
  role: "kasir",
  is_active: true,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
}

const LINE: CartItem = {
  cart_id: "line-1",
  product_id: 1,
  product_name: "Indomie Goreng",
  product_price: 3000,
  quantity: 2,
  stock: 50,
  unit: "pcs",
}

const RESULT = {
  transaction: { id: 1, change_amount: 0 },
  items: [],
  payment_breakdown: [],
} as unknown as TransactionResult

let api: ApiMock

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onSuccess = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <PaymentDialog open onOpenChange={() => {}} onSuccess={onSuccess} />
    </QueryClientProvider>,
  )
  return onSuccess
}

/** Rupiah as Testing Library reads it: the non-breaking space normalised away. */
function rupiah(amount: number) {
  return formatRupiah(amount).replace(/\s+/g, " ")
}

/** The value next to a `SummaryList` label. */
function summaryValue(label: string) {
  return screen.getByText(label).nextElementSibling?.textContent?.replace(/\s+/g, " ")
}

function checkoutBody(): CheckoutTransactionInput {
  return api.lastCall("POST /transactions")?.body as CheckoutTransactionInput
}

beforeEach(() => {
  api = installApiMock({
    "GET /settings/sales": SETTINGS.sales,
    "POST /transactions": RESULT,
  })
  useAuthStore.setState({ user: KASIR })
  useCartStore.setState({
    items: [LINE],
    heldCarts: [],
    itemDiscounts: {},
    transactionDiscount: null,
    ppobCounter: 0,
    checkoutKey: null,
  })
})

describe("quick amounts and change", () => {
  it("fills the cash field with a quick amount and shows the change", async () => {
    renderDialog()
    const cash = await screen.findByLabelText("Nominal Tunai")

    fireEvent.click(screen.getByRole("button", { name: /^10k/ }))

    expect(cash).toHaveValue("10.000")
    expect(summaryValue("Kembalian")).toBe(rupiah(4000))
    expect(screen.getByRole("button", { name: "Bayar" })).toBeEnabled()
  })

  it("names the shortfall of a quick amount below the total", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")

    fireEvent.click(screen.getByRole("button", { name: /^5k/ }))

    expect(summaryValue("Kurang")).toBe(rupiah(1000))
    expect(screen.getByRole("button", { name: "Bayar" })).toBeDisabled()
  })

  it("pays the exact total from the Uang Pas button, with no change", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")

    fireEvent.click(screen.getByRole("button", { name: "Uang Pas" }))
    expect(summaryValue("Kembalian")).toBe(rupiah(0))
    fireEvent.click(screen.getByRole("button", { name: "Bayar" }))

    await waitFor(() => expect(api.callsFor("POST /transactions")).toHaveLength(1))
    expect(checkoutBody()).toMatchObject({ payment_method: "cash", payment_amount: 6000 })
    expect(checkoutBody().payment_breakdown).toBeUndefined()
  })

  it("fills the exact total with the backquote key from anywhere, then pays on Enter", async () => {
    renderDialog()
    const cash = await screen.findByLabelText("Nominal Tunai")

    fireEvent.keyDown(document.body, { key: "`", code: "Backquote" })
    expect(cash).toHaveValue("6.000")
    await waitFor(() => expect(cash).toHaveFocus())
    fireEvent.keyDown(cash, { key: "Enter", timeStamp: 50_000 })

    await waitFor(() => expect(api.callsFor("POST /transactions")).toHaveLength(1))
    expect(checkoutBody().payment_amount).toBe(6000)
  })

  it("does not overwrite the cash with the backquote typed into the notes", async () => {
    renderDialog()
    const cash = await screen.findByLabelText("Nominal Tunai")
    fireEvent.change(cash, { target: { value: "20000" } })

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Catatan" }), {
      key: "`",
      code: "Backquote",
    })

    expect(cash).toHaveValue("20.000")
  })
})

describe("split payments", () => {
  it("fills the cash leg with what QRIS leaves on backslash", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")
    fireEvent.click(screen.getByRole("button", { name: /QRIS/ }))
    fireEvent.click(screen.getByRole("button", { name: /^Tunai$/ }))
    fireEvent.change(await screen.findByLabelText("Nominal QRIS"), { target: { value: "4000" } })

    const cash = screen.getByLabelText("Nominal Tunai")
    fireEvent.keyDown(cash, { key: "\\" })

    expect(cash).toHaveValue("2.000")
    expect(screen.getByRole("button", { name: "Bayar" })).toBeEnabled()
  })

  it("hands back the cash beyond what QRIS leaves and sends the breakdown", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")
    fireEvent.click(screen.getByRole("button", { name: /QRIS/ }))
    fireEvent.click(screen.getByRole("button", { name: /^Tunai$/ }))
    fireEvent.change(await screen.findByLabelText("Nominal QRIS"), { target: { value: "4000" } })
    fireEvent.change(screen.getByLabelText("Nominal Tunai"), { target: { value: "5000" } })

    // 4.000 by QRIS leaves 2.000; 5.000 in cash gives 3.000 back.
    expect(summaryValue("Kembalian tunai")).toBe(rupiah(3000))
    fireEvent.click(screen.getByRole("button", { name: "Bayar" }))

    await waitFor(() => expect(api.callsFor("POST /transactions")).toHaveLength(1))
    const body = checkoutBody()
    expect(body.payment_amount).toBe(9000)
    expect(body.payment_breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ payment_method: "qris", amount: 4000 }),
        expect.objectContaining({ payment_method: "cash", amount: 5000 }),
      ]),
    )
    expect(body.payment_breakdown).toHaveLength(2)
  })

  it("refuses two non-cash legs that add up to more than the total", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")
    fireEvent.click(screen.getByRole("button", { name: /QRIS/ }))
    fireEvent.click(screen.getByRole("button", { name: /Transfer/ }))
    fireEvent.change(await screen.findByLabelText("Nominal QRIS"), { target: { value: "4000" } })
    fireEvent.change(screen.getByLabelText("Nominal Transfer"), { target: { value: "4000" } })

    expect(screen.getByRole("alert")).toHaveTextContent(/kelebihan/)
    expect(screen.getByRole("button", { name: "Bayar" })).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Nominal Transfer"), { target: { value: "2000" } })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bayar" })).toBeEnabled()
  })

  it("does not book a split with an empty cash leg", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")
    // QRIS takes the whole total, then cash is ticked but left empty.
    fireEvent.click(screen.getByRole("button", { name: /QRIS/ }))
    fireEvent.click(screen.getByRole("button", { name: /^Tunai$/ }))
    await screen.findByLabelText("Nominal Tunai")

    expect(screen.getByLabelText("Nominal QRIS")).toHaveValue("6.000")
    expect(screen.getByRole("button", { name: "Bayar" })).toBeDisabled()
  })
})

describe("discounts handed over from the cart", () => {
  it("charges the discounted total and sends each discount once", async () => {
    useCartStore.setState({
      items: [LINE, { ...LINE, cart_id: "line-2", product_id: 2, product_name: "Teh", quantity: 1 }],
      itemDiscounts: { "line-1": { type: "fixed", value: 1000 } },
      transactionDiscount: { type: "percentage", value: 10 },
    })
    renderDialog()
    const cash = await screen.findByLabelText("Nominal Tunai")

    // 9.000 − 1.000 = 8.000, then 10% = 800 → 7.200.
    expect(screen.getByText(rupiah(7200))).toBeInTheDocument()
    expect(
      screen.getByText(`Subtotal ${rupiah(9000)} · Diskon -${rupiah(1800)}`),
    ).toBeInTheDocument()

    fireEvent.change(cash, { target: { value: "7200" } })
    fireEvent.click(screen.getByRole("button", { name: "Bayar" }))

    await waitFor(() => expect(api.callsFor("POST /transactions")).toHaveLength(1))
    const body = checkoutBody()
    expect(body.transaction_discount).toBe(800)
    expect(body.items.map((item) => item.item_discount)).toEqual([1000, undefined])
    expect(body.payment_amount).toBe(7200)
  })

  it("accepts cash for exactly the discounted total, not a rupiah less", async () => {
    useCartStore.setState({ transactionDiscount: { type: "fixed", value: 1000 } })
    renderDialog()
    const cash = await screen.findByLabelText("Nominal Tunai")

    fireEvent.change(cash, { target: { value: "4999" } })
    expect(screen.getByRole("button", { name: "Bayar" })).toBeDisabled()

    fireEvent.change(cash, { target: { value: "5000" } })
    expect(screen.getByRole("button", { name: "Bayar" })).toBeEnabled()
  })
})

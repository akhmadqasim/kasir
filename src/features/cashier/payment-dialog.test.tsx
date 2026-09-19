import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const toastWarning = vi.fn()

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: (message: string) => toastWarning(message),
  },
}))

import { installApiMock, type ApiMock } from "@/test-utils/api-mock"
import type { User } from "@/features/auth/types"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useCartStore } from "@/stores/cart-store"
import { PaymentDialog } from "./components/payment/payment-dialog"
import type { CartItem, TransactionResult } from "./types"

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

/** What `POST /api/transactions` answers with. The dialog only passes it on. */
const CHECKOUT_RESULT: TransactionResult = {
  transaction: {
    id: 1,
    receipt_number: "TRX-20260905-0001",
    user_id: KASIR.id,
    total_amount: 6000,
    subtotal_amount: 6000,
    discount_amount: 0,
    payment_method: "cash",
    payment_amount: 50000,
    change_amount: 44000,
    status: "completed",
    notes: null,
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    updated_at: null,
    created_at: "2026-09-05 01:00:00",
  },
  items: [],
  payment_breakdown: [],
}

function renderDialog(onOpenChange: (open: boolean) => void = () => {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PaymentDialog open onOpenChange={onOpenChange} onSuccess={() => {}} />
    </QueryClientProvider>,
  )
}

/**
 * Penjaga scan membaca `event.timeStamp` dari `onKeyDown` (bukan `onChange`
 * seperti sebelum `RupiahField`: `TextField` HeroUI hanya meneruskan
 * nilainya, bukan event DOM), jadi test-nya harus mengarang keduanya —
 * sebuah keydown per digit untuk waktunya, lalu change supaya nilai kolomnya
 * ikut berubah seperti pengetikan sungguhan.
 */
function fireWithTimeStamp(field: HTMLElement, event: Event, timeStamp: number) {
  Object.defineProperty(event, "timeStamp", { value: timeStamp })
  fireEvent(field, event)
}

function typeDigit(field: HTMLElement, valueSoFar: string, timeStamp: number) {
  fireWithTimeStamp(field, createEvent.keyDown(field, { key: valueSoFar.slice(-1) }), timeStamp)
  fireWithTimeStamp(field, createEvent.change(field, { target: { value: valueSoFar } }), timeStamp)
}

function pressEnter(field: HTMLElement, timeStamp: number) {
  fireWithTimeStamp(field, createEvent.keyDown(field, { key: "Enter" }), timeStamp)
}

/** Scanner mengetik seluruh payload-nya dalam satu semburan, lalu Enter. */
function scanIntoField(field: HTMLElement, barcode: string) {
  for (let length = 1; length <= barcode.length; length++) {
    typeDigit(field, barcode.slice(0, length), 1000 + length * 10)
  }
  pressEnter(field, 1000 + barcode.length * 10 + 20)
}

let api: ApiMock

beforeEach(() => {
  api = installApiMock({
    "POST /transactions": CHECKOUT_RESULT,
  })
  toastWarning.mockReset()
  useAuthStore.setState({ user: KASIR })
  useShiftStore.setState({ activeShift: null })
  useCartStore.setState({
    items: [LINE],
    heldCarts: [],
    itemDiscounts: {},
    transactionDiscount: null,
    ppobCounter: 0,
  })
})

describe("payment dialog", () => {
  it("opens on cash with the amount field ready", async () => {
    renderDialog()

    expect(await screen.findByLabelText("Nominal Tunai")).toBeInTheDocument()
    expect(screen.getByText("Rp 6.000")).toBeInTheDocument()
  })

  it("has no on-screen keypad — the till is a PC with a keyboard", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")

    for (const digit of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "00", "000"]) {
      expect(screen.queryByRole("button", { name: digit })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole("button", { name: /Hapus/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Kosongkan/ })).not.toBeInTheDocument()
  })

  it("still offers the quick round-up amounts and Uang Pas as plain buttons", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")

    expect(screen.getByRole("button", { name: "5k" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "100k" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Uang Pas" })).toBeInTheDocument()
  })

  it("refuses a barcode burst instead of closing the sale", async () => {
    renderDialog()
    const field = await screen.findByLabelText("Nominal Tunai")

    scanIntoField(field, "8991234567890")

    await waitFor(() => expect(toastWarning).toHaveBeenCalled())
    expect(toastWarning.mock.lastCall![0]).toMatch(/Barcode terbaca di kolom nominal/)
    expect(api.callsFor("POST /transactions")).toHaveLength(0)
    // Nominal barcode dibuang, kasir tidak boleh menagih angka itu.
    expect(field).toHaveValue("")
  })

  it("confirms a typed amount on Enter", async () => {
    renderDialog()
    const field = await screen.findByLabelText("Nominal Tunai")

    // Kasir mengetik, lalu berhenti sejenak sebelum Enter — jauh di luar jarak
    // Enter sebuah scanner.
    fireEvent.change(field, { target: { value: "50000" } })
    pressEnter(field, 3000)

    await waitFor(() => expect(api.lastCall("POST /transactions")).toBeDefined())

    // The cashier is the session, not a number in the payload.
    const checkout = api.lastCall("POST /transactions")
    expect(checkout?.body).not.toHaveProperty("user_id")
    // The key belongs to the cart and is minted on the first attempt, so what
    // can be held here is that one travelled at all — not which one.
    expect(checkout?.headers.get("Idempotency-Key")).toBeTruthy()
  })

  it("blocks an implausible amount at the Bayar button", async () => {
    renderDialog()
    const field = await screen.findByLabelText("Nominal Tunai")

    fireEvent.change(field, { target: { value: "200000000" } })

    expect(await screen.findByText(/Nominal pembayaran melebihi/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bayar" })).toBeDisabled()
  })

  it("shows kembalian in a success tone once cash covers the total", async () => {
    renderDialog()
    const field = await screen.findByLabelText("Nominal Tunai")

    fireEvent.change(field, { target: { value: "10000" } })

    expect(await screen.findByText("Kembalian")).toBeInTheDocument()
    expect(screen.getByText("Rp 4.000")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bayar" })).toBeEnabled()
  })

  it("keeps Bayar disabled while cash is short of the total", async () => {
    renderDialog()
    const field = await screen.findByLabelText("Nominal Tunai")

    fireEvent.change(field, { target: { value: "1000" } })

    expect(screen.getByRole("button", { name: "Bayar" })).toBeDisabled()
  })

  it("keeps the active method derived from the selection", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")

    // Selama pilihannya masih tunai tunggal, metode lain menggantikannya.
    fireEvent.click(screen.getByRole("button", { name: /QRIS/ }))

    expect(await screen.findByLabelText("Nominal QRIS")).toBeInTheDocument()
    expect(screen.queryByLabelText("Nominal Tunai")).not.toBeInTheDocument()
  })

  it("toggles a method from its bare letter and lands the cursor in that method's amount field", async () => {
    renderDialog()
    const cash = await screen.findByLabelText("Nominal Tunai")
    cash.focus()

    // "q" typed into the (numeric) cash field means QRIS, not a character.
    fireEvent.keyDown(cash, { key: "q" })

    const qris = await screen.findByLabelText("Nominal QRIS")
    expect(screen.getByRole("button", { name: /QRIS/ })).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByLabelText("Nominal Tunai")).not.toBeInTheDocument()
    // The field that had focus is gone; the cursor must follow the method,
    // so the next digits and Enter go somewhere.
    await waitFor(() => expect(qris).toHaveFocus())
  })

  it("still toggles a method from Alt+letter, the same as clicking its button", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")

    fireEvent.keyDown(window, { key: "q", altKey: true })

    expect(await screen.findByLabelText("Nominal QRIS")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /QRIS/ })).toHaveAttribute("aria-pressed", "true")
  })

  it("leaves a bare letter alone inside the notes and bank fields — they are typed into", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")

    fireEvent.keyDown(screen.getByLabelText("Catatan"), { key: "s" })
    expect(screen.queryByLabelText("Nominal Transfer")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Transfer/ }))
    await screen.findByLabelText("Nominal Transfer")
    expect(screen.queryByLabelText("Nominal Tunai")).not.toBeInTheDocument()
    // The "A" in "BCA" must not switch Tunai back on.
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Bank" }), { key: "a" })
    expect(screen.queryByLabelText("Nominal Tunai")).not.toBeInTheDocument()
  })

  it("leaves a bare letter alone inside the PIN field", async () => {
    useCartStore.setState({ items: [PPOB_LINE] })
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")

    fireEvent.keyDown(await screen.findByLabelText("PIN Mitra"), { key: "q" })
    expect(screen.queryByLabelText("Nominal QRIS")).not.toBeInTheDocument()
  })

  it("closes on Escape", async () => {
    const onOpenChange = vi.fn()
    renderDialog(onOpenChange)
    const field = await screen.findByLabelText("Nominal Tunai")

    fireEvent.keyDown(field, { key: "Escape" })

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("lets a transfer through without a bank; the bank is optional", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")

    fireEvent.click(screen.getByRole("button", { name: /Transfer/ }))

    expect(screen.queryByText(/Isi nama bank/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bayar" })).toBeEnabled()
  })

  it("accepts a bank picked from the curated list", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")
    fireEvent.click(screen.getByRole("button", { name: /Transfer/ }))

    const bankField = await screen.findByRole("combobox", { name: "Bank" })
    bankField.focus()
    fireEvent.click(await screen.findByRole("option", { name: "BCA" }))

    expect(bankField).toHaveValue("BCA")

    fireEvent.change(await screen.findByLabelText("Nominal Transfer"), {
      target: { value: "6000" },
    })
    expect(screen.getByRole("button", { name: "Bayar" })).toBeEnabled()
  })

  it("accepts a bank name typed free-hand, not just the curated list", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")
    fireEvent.click(screen.getByRole("button", { name: /Transfer/ }))

    const bankField = await screen.findByRole("combobox", { name: "Bank" })
    fireEvent.change(bankField, { target: { value: "BPR Toko Sebelah" } })

    expect(bankField).toHaveValue("BPR Toko Sebelah")
    expect(
      screen.queryByText("Isi nama bank untuk pembayaran transfer bank."),
    ).not.toBeInTheDocument()

    fireEvent.change(await screen.findByLabelText("Nominal Transfer"), {
      target: { value: "6000" },
    })
    expect(screen.getByRole("button", { name: "Bayar" })).toBeEnabled()
  })

  it("asks which wallet paid an e-wallet sale and sends it along", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")
    fireEvent.click(screen.getByRole("button", { name: /E-Wallet/ }))

    const walletField = await screen.findByPlaceholderText("Dompet digital")
    walletField.focus()
    // Only wallets are offered here — a bank is not something an e-wallet pays from.
    expect(await screen.findByRole("option", { name: "DANA" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "BCA" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("option", { name: "DANA" }))

    const amount = await screen.findByLabelText("Nominal E-Wallet")
    fireEvent.change(amount, { target: { value: "6000" } })
    pressEnter(amount, 3000)

    await waitFor(() => expect(api.lastCall("POST /transactions")).toBeDefined())
    const body = api.lastCall("POST /transactions")?.body as {
      payment_breakdown: { payment_method: string; bank_name?: string }[]
    }
    expect(body.payment_breakdown).toEqual([
      { payment_method: "ewallet", bank_name: "DANA", amount: 6000 },
    ])
  })

  it("offers a bank for debit and any app for QRIS, both optional", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")

    fireEvent.click(screen.getByRole("button", { name: /Debit/ }))
    expect(await screen.findByPlaceholderText("Bank kartu")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /QRIS/ }))
    expect(await screen.findByPlaceholderText("Aplikasi pembayar")).toBeInTheDocument()

    fireEvent.change(await screen.findByLabelText("Nominal Debit"), {
      target: { value: "3000" },
    })
    fireEvent.change(await screen.findByLabelText("Nominal QRIS"), {
      target: { value: "3000" },
    })
    expect(screen.getByRole("button", { name: "Bayar" })).toBeEnabled()
  })

  it("sums split payments across methods before enabling Bayar", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")

    // Tunai tunggal → QRIS menggantikan (radio), lalu Tunai ditambahkan lagi
    // (mode split, bukan radio lagi karena pilihannya sudah bukan tunai tunggal).
    fireEvent.click(screen.getByRole("button", { name: /QRIS/ }))
    fireEvent.click(screen.getByRole("button", { name: /^Tunai$/ }))

    fireEvent.change(await screen.findByLabelText("Nominal Tunai"), {
      target: { value: "2000" },
    })
    fireEvent.change(await screen.findByLabelText("Nominal QRIS"), {
      target: { value: "3000" },
    })

    // Rp 2.000 + Rp 3.000 = Rp 5.000, masih kurang dari total Rp 6.000.
    expect(await screen.findByText(/masih kurang/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bayar" })).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Nominal QRIS"), { target: { value: "4000" } })

    expect(screen.queryByText(/masih kurang/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bayar" })).toBeEnabled()
  })
})

/** A PPOB line the way `addPpobItem` builds one (`src/stores/cart-store.ts`). */
const PPOB_LINE: CartItem = {
  cart_id: "ppob-1-1000",
  product_name: "Pulsa Telkomsel 10K",
  product_price: 12000,
  quantity: 1,
  stock: 0,
  unit: "pcs",
  is_ppob: true,
  service_type: "pulsa",
  service_ref: "08123456789",
  buy_price: 10000,
  sell_price: 12000,
  ppob_product_id: 101,
  ppob_product_code: "TS10",
}

describe("PIN Mitra untuk transaksi PPOB", () => {
  it("tidak menampilkan kolom PIN untuk keranjang tanpa barang PPOB", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")

    expect(screen.queryByLabelText("PIN Mitra")).not.toBeInTheDocument()
  })

  it("menampilkan kolom PIN saat keranjang berisi barang PPOB", async () => {
    useCartStore.setState({ items: [PPOB_LINE] })
    renderDialog()

    expect(await screen.findByLabelText("PIN Mitra")).toBeInTheDocument()
  })

  it("mematikan Bayar sampai PIN 4-6 digit terisi", async () => {
    useCartStore.setState({ items: [PPOB_LINE] })
    renderDialog()
    const cashField = await screen.findByLabelText("Nominal Tunai")
    const pinField = await screen.findByLabelText("PIN Mitra")

    fireEvent.change(cashField, { target: { value: "12000" } })
    expect(screen.getByRole("button", { name: "Bayar" })).toBeDisabled()

    fireEvent.change(pinField, { target: { value: "123" } })
    expect(screen.getByRole("button", { name: "Bayar" })).toBeDisabled()

    fireEvent.change(pinField, { target: { value: "123456" } })
    expect(screen.getByRole("button", { name: "Bayar" })).toBeEnabled()
  })

  it("membawa ppob_pin di body checkout saat keranjang berisi PPOB", async () => {
    useCartStore.setState({ items: [PPOB_LINE] })
    renderDialog()

    fireEvent.change(await screen.findByLabelText("Nominal Tunai"), {
      target: { value: "12000" },
    })
    fireEvent.change(await screen.findByLabelText("PIN Mitra"), {
      target: { value: "123456" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Bayar" }))

    await waitFor(() => expect(api.lastCall("POST /transactions")).toBeDefined())
    const body = api.lastCall("POST /transactions")?.body as { ppob_pin?: string }
    expect(body.ppob_pin).toBe("123456")
  })

  it("tidak mengirim ppob_pin sama sekali untuk keranjang tanpa barang PPOB", async () => {
    renderDialog()
    fireEvent.change(await screen.findByLabelText("Nominal Tunai"), {
      target: { value: "50000" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Bayar" }))

    await waitFor(() => expect(api.lastCall("POST /transactions")).toBeDefined())
    const body = api.lastCall("POST /transactions")?.body as Record<string, unknown>
    expect(body.ppob_pin).toBeUndefined()
  })

  it("Enter di kolom PIN membayar seperti Enter di kolom nominal", async () => {
    useCartStore.setState({ items: [PPOB_LINE] })
    renderDialog()

    fireEvent.change(await screen.findByLabelText("Nominal Tunai"), {
      target: { value: "12000" },
    })
    const pinField = await screen.findByLabelText("PIN Mitra")
    fireEvent.change(pinField, { target: { value: "123456" } })
    fireEvent.keyDown(pinField, { key: "Enter" })

    await waitFor(() => expect(api.lastCall("POST /transactions")).toBeDefined())
  })

  it("mengosongkan PIN saat dialog ditutup", async () => {
    const onOpenChange = vi.fn()
    useCartStore.setState({ items: [PPOB_LINE] })
    renderDialog(onOpenChange)

    const pinField = await screen.findByLabelText("PIN Mitra")
    fireEvent.change(pinField, { target: { value: "123456" } })
    fireEvent.keyDown(pinField, { key: "Escape" })

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    // `open` stays true here (the mock does not act on it), so the field is
    // still mounted — and now empty, because clearing does not wait for the
    // parent to actually unmount the dialog.
    expect(screen.getByLabelText("PIN Mitra")).toHaveValue("")
  })
})

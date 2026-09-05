import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const invoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args),
}))

const toastWarning = vi.fn()

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: (message: string) => toastWarning(message),
  },
}))

import type { User } from "@/features/auth/types"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useCartStore } from "./hooks/use-cart-store"
import { PaymentDialog } from "./components/payment-dialog"
import type { CartItem } from "./types"

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

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PaymentDialog open onOpenChange={() => {}} onSuccess={() => {}} />
    </QueryClientProvider>
  )
}

/**
 * Penjaga scan membaca `event.timeStamp`, jadi test-nya harus mengarangnya sendiri.
 * Kalau jaraknya dibiarkan ikut waktu nyata, satu worker yang sedang sibuk sudah
 * cukup untuk membuat semburan 13 karakter terbaca sebagai ketikan manusia.
 */
function fireWithTimeStamp(field: HTMLElement, event: Event, timeStamp: number) {
  Object.defineProperty(event, "timeStamp", { value: timeStamp })
  fireEvent(field, event)
}

function typeAmount(field: HTMLElement, value: string, timeStamp: number) {
  fireWithTimeStamp(field, createEvent.change(field, { target: { value } }), timeStamp)
}

function pressEnter(field: HTMLElement, timeStamp: number) {
  fireWithTimeStamp(field, createEvent.keyDown(field, { key: "Enter" }), timeStamp)
}

/** Scanner mengetik seluruh payload-nya dalam satu semburan, lalu Enter. */
function scanIntoField(field: HTMLElement, barcode: string) {
  for (let length = 1; length <= barcode.length; length++) {
    typeAmount(field, barcode.slice(0, length), 1000 + length * 10)
  }
  pressEnter(field, 1000 + barcode.length * 10 + 20)
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue(null)
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

  it("refuses a barcode burst instead of closing the sale", async () => {
    renderDialog()
    const field = await screen.findByLabelText("Nominal Tunai")

    scanIntoField(field, "8991234567890")

    await waitFor(() => expect(toastWarning).toHaveBeenCalled())
    expect(toastWarning.mock.lastCall![0]).toMatch(/Barcode terbaca di kolom nominal/)
    expect(invoke).not.toHaveBeenCalledWith("checkout_transaction", expect.anything())
    // Nominal barcode dibuang, kasir tidak boleh menagih angka itu.
    expect(field).toHaveValue("")
  })

  it("confirms a typed amount on Enter", async () => {
    renderDialog()
    const field = await screen.findByLabelText("Nominal Tunai")

    // Kasir mengetik, lalu berhenti sejenak sebelum Enter — jauh di luar jarak
    // Enter sebuah scanner.
    typeAmount(field, "50000", 1000)
    pressEnter(field, 3000)

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("checkout_transaction", expect.anything())
    )
  })

  it("blocks an implausible amount at the Bayar button", async () => {
    renderDialog()
    const field = await screen.findByLabelText("Nominal Tunai")

    fireEvent.change(field, { target: { value: "200000000" } })

    expect(
      await screen.findByText(/Nominal pembayaran melebihi/)
    ).toBeInTheDocument()
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

  it("asks for a bank before a transfer can be confirmed", async () => {
    renderDialog()
    await screen.findByLabelText("Nominal Tunai")

    fireEvent.click(screen.getByRole("button", { name: /Transfer Bank/ }))

    expect(
      await screen.findByText("Isi nama bank untuk pembayaran transfer bank.")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bayar" })).toBeDisabled()
  })
})

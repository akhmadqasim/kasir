import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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

/** Scanner mengetik seluruh payload-nya dalam satu semburan, lalu Enter. */
function scanIntoField(field: HTMLElement, barcode: string) {
  for (let length = 1; length <= barcode.length; length++) {
    fireEvent.change(field, { target: { value: barcode.slice(0, length) } })
  }
  fireEvent.keyDown(field, { key: "Enter" })
}

/** Menunggu lebih lama dari jarak Enter sebuah scanner (120 ms). */
function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

    fireEvent.change(field, { target: { value: "50000" } })
    await pause(200)
    fireEvent.keyDown(field, { key: "Enter" })

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

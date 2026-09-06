import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { installApiMock } from "@/test-utils/api-mock"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useCartStore, type HeldCart } from "./hooks/use-cart-store"
import { CartPanel } from "./components/cart-panel"
import type { CartItem } from "./types"

function cartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    cart_id: "line-1",
    product_id: 1,
    product_name: "Indomie Goreng",
    product_price: 3000,
    quantity: 2,
    stock: 50,
    unit: "pcs",
    ...overrides,
  }
}

function heldCart(overrides: Partial<HeldCart> = {}): HeldCart {
  return {
    id: "hold-1",
    label: "Pelanggan 1",
    items: [cartItem()],
    itemDiscounts: {},
    transactionDiscount: null,
    total: 6000,
    heldAt: Date.parse("2026-09-05T01:00:00Z"),
    ...overrides,
  }
}

function resetStore(state: Partial<ReturnType<typeof useCartStore.getState>> = {}) {
  useCartStore.setState({
    items: [],
    heldCarts: [],
    itemDiscounts: {},
    transactionDiscount: null,
    ppobCounter: 0,
    ...state,
  })
}

function renderPanel(props: Partial<Parameters<typeof CartPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <CartPanel onPay={() => {}} {...props} />
    </MemoryRouter>
  )
}

/** Shortcut kasir selalu datang dari window, bukan dari elemen yang sedang fokus. */
function pressFunctionKey(key: string) {
  fireEvent.keyDown(window, { key })
}

beforeEach(() => {
  // The panel reads the cart and the shift out of stores and asks the server for
  // nothing on its own — the one request it can produce, a cash-flow entry, only
  // leaves once that dialog is submitted. An empty route table therefore states
  // the expectation rather than merely tolerating it: any request from this
  // panel fails the test instead of quietly resolving to null.
  installApiMock()
  resetStore()
  useShiftStore.setState({ activeShift: null })
})

describe("cart panel", () => {
  it("lists cart lines in the table", () => {
    resetStore({ items: [cartItem(), cartItem({ cart_id: "line-2", product_name: "Beras 5kg" })] })
    renderPanel()

    const table = screen.getByRole("grid", { name: "Isi keranjang" })
    expect(within(table).getByText("Indomie Goreng")).toBeInTheDocument()
    expect(within(table).getByText("Beras 5kg")).toBeInTheDocument()
    expect(screen.getByText("4 item")).toBeInTheDocument()
  })

  it("shows the empty state with no lines", () => {
    renderPanel()

    expect(screen.getByText("Keranjang Kosong")).toBeInTheDocument()
    expect(screen.queryByRole("grid", { name: "Isi keranjang" })).not.toBeInTheDocument()
  })

  it("opens the discount dialog on F2", async () => {
    resetStore({ items: [cartItem()] })
    renderPanel()

    pressFunctionKey("F2")

    expect(await screen.findByRole("dialog")).toHaveAccessibleName(
      "Diskon Total Transaksi"
    )
  })

  it("ignores F2 while a page dialog covers the panel", () => {
    resetStore({ items: [cartItem()] })
    renderPanel({ shortcutsDisabled: true })

    pressFunctionKey("F2")

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("ignores F2 while one of its own dialogs is already open", async () => {
    resetStore({ items: [cartItem()], heldCarts: [heldCart()] })
    renderPanel()

    pressFunctionKey("F9")
    expect(await screen.findByRole("dialog")).toHaveAccessibleName(
      "Transaksi Tersimpan"
    )

    // Kalau penjaganya lepas, dialog diskon menumpuk di atas dialog recall.
    pressFunctionKey("F2")
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
  })

  it("does not open the recall dialog with nothing held", () => {
    resetStore({ items: [cartItem()] })
    renderPanel()

    pressFunctionKey("F9")

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("recalls the highlighted cart with the arrow keys and Enter", async () => {
    const recallCart = vi.fn()
    resetStore({
      items: [],
      heldCarts: [heldCart(), heldCart({ id: "hold-2", label: "Pelanggan 2" })],
    })
    useCartStore.setState({ recallCart })
    renderPanel()

    pressFunctionKey("F9")
    await screen.findByRole("dialog")

    // Sorotan mulai di baris pertama; satu panah bawah memindahkannya ke kedua.
    fireEvent.keyDown(window, { key: "ArrowDown" })
    fireEvent.keyDown(window, { key: "Enter" })

    expect(recallCart).toHaveBeenCalledWith("hold-2")
  })

  it("recalls by its row number", async () => {
    const recallCart = vi.fn()
    resetStore({
      heldCarts: [heldCart(), heldCart({ id: "hold-2", label: "Pelanggan 2" })],
    })
    useCartStore.setState({ recallCart })
    renderPanel()

    pressFunctionKey("F9")
    await screen.findByRole("dialog")

    fireEvent.keyDown(window, { key: "2" })

    expect(recallCart).toHaveBeenCalledWith("hold-2")
  })

  it("deletes the highlighted cart with Delete", async () => {
    const removeHeldCart = vi.fn()
    resetStore({
      heldCarts: [heldCart(), heldCart({ id: "hold-2", label: "Pelanggan 2" })],
    })
    useCartStore.setState({ removeHeldCart })
    renderPanel()

    pressFunctionKey("F9")
    await screen.findByRole("dialog")

    fireEvent.keyDown(window, { key: "Delete" })

    expect(removeHeldCart).toHaveBeenCalledWith("hold-1")
  })

  it("opens the line editor on F10 and closes it on the second press", async () => {
    resetStore({ items: [cartItem()] })
    renderPanel()

    pressFunctionKey("F10")
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Indomie Goreng")

    pressFunctionKey("F10")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})

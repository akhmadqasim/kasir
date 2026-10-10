import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import { installApiMock } from "@/test-utils/api-mock"
import { pressKey } from "@/test-utils/keyboard"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useCartStore } from "@/stores/cart-store"
import { CartItemEditDialog } from "./components/cart-item-edit-dialog"
import { CartPanel } from "./components/cart-panel"
import type { CartItem } from "./types"

/**
 * A scanner is a keyboard: whatever field has focus when the cashier scans
 * the next item gets the barcode's digits and its Enter. The payment amount,
 * the PIN, the quantity and the receipt dialog all refuse such a burst. These
 * tests aim the same burst at the other cart dialogs' fields.
 */

const BARCODE = "8991234567890"

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

function fireAt(field: HTMLElement, event: Event, timeStamp: number) {
  Object.defineProperty(event, "timeStamp", { value: timeStamp })
  fireEvent(field, event)
  return event
}

/**
 * The scanner's burst: one timed keydown and one change per character, 10ms
 * apart, then Enter 20ms after the last one. Returns the Enter event, so a
 * caller can tell whether the field refused it (`defaultPrevented`).
 */
function scanInto(field: HTMLElement, barcode: string, startAt = 1000): Event {
  for (let length = 1; length <= barcode.length; length++) {
    const at = startAt + length * 10
    fireAt(field, createEvent.keyDown(field, { key: barcode[length - 1] }), at)
    fireEvent.change(field, { target: { value: barcode.slice(0, length) } })
  }
  const enter = fireAt(
    field,
    createEvent.keyDown(field, { key: "Enter" }),
    startAt + barcode.length * 10 + 20,
  )
  fireEvent.keyUp(field, { key: "Enter" })
  return enter
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <CartPanel onPay={() => {}} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  installApiMock()
  useShiftStore.setState({ activeShift: null })
  useCartStore.setState({
    items: [cartItem()],
    heldCarts: [],
    itemDiscounts: {},
    transactionDiscount: null,
    ppobCounter: 0,
  })
})

describe("transaction discount dialog (F2)", () => {
  it("saves a discount typed by hand and closes on Enter", async () => {
    renderPanel()
    fireEvent.keyDown(window, { key: "F2" })
    const dialog = await screen.findByRole("dialog", { name: "Diskon Total Transaksi" })
    const field = within(dialog).getByRole("textbox", { name: "Nilai diskon" })

    // Typed by hand: well apart, then a pause before Enter.
    fireAt(field, createEvent.keyDown(field, { key: "5" }), 1000)
    fireEvent.change(field, { target: { value: "5" } })
    fireAt(field, createEvent.keyDown(field, { key: "0" }), 1400)
    fireEvent.change(field, { target: { value: "50" } })
    fireAt(field, createEvent.keyDown(field, { key: "0" }), 1800)
    fireEvent.change(field, { target: { value: "500" } })
    fireAt(field, createEvent.keyDown(field, { key: "Enter" }), 3000)

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(useCartStore.getState().transactionDiscount).toEqual({ type: "fixed", value: 500 })
    expect(useCartStore.getState().getTotal()).toBe(5500)
  })

  it("clears the discount with Reset Diskon", async () => {
    useCartStore.setState({ transactionDiscount: { type: "percentage", value: 10 } })
    renderPanel()
    fireEvent.keyDown(window, { key: "F2" })
    const dialog = await screen.findByRole("dialog", { name: "Diskon Total Transaksi" })
    expect(within(dialog).getByRole("textbox", { name: "Nilai diskon (%)" })).toHaveValue("10")

    fireEvent.click(within(dialog).getByRole("button", { name: "Reset Diskon" }))

    expect(useCartStore.getState().transactionDiscount).toBeNull()
    expect(useCartStore.getState().getTotal()).toBe(6000)
  })

  // F2 focuses the field, and it saves as it is typed: unguarded, a barcode
  // scanned into it would be a fixed discount cut down to the whole purchase
  // (total Rp 0), and the scan's Enter would close the dialog.
  it("does not turn a barcode scanned into the field into a discount", async () => {
    renderPanel()
    fireEvent.keyDown(window, { key: "F2" })
    const dialog = await screen.findByRole("dialog", { name: "Diskon Total Transaksi" })
    const field = within(dialog).getByRole("textbox", { name: "Nilai diskon" })

    // The store is never handed a digit of the burst, not even for a moment.
    const writes: unknown[] = []
    const unsubscribe = useCartStore.subscribe((state) => writes.push(state.transactionDiscount))
    scanInto(field, BARCODE)
    unsubscribe()

    expect(writes.filter((discount) => discount !== null)).toEqual([])
    expect(useCartStore.getState().transactionDiscount).toBeNull()
    expect(useCartStore.getState().getTotal()).toBe(6000)
    expect(field).toHaveValue("")
    expect(screen.getByRole("dialog", { name: "Diskon Total Transaksi" })).toBeInTheDocument()
    // Nor is it saved late, once the burst has gone quiet.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(useCartStore.getState().transactionDiscount).toBeNull()
  })
})

describe("cart line editor (F10) discount field", () => {
  function renderEditor(item: CartItem) {
    const onOpenChange = vi.fn()
    render(<CartItemEditDialog open item={item} onOpenChange={onOpenChange} />)
    return onOpenChange
  }

  it("keeps a nominal discount typed by hand and saves it on Enter", () => {
    const onOpenChange = renderEditor(cartItem())
    const field = screen.getByRole("textbox", { name: "Nilai diskon" })

    fireEvent.change(field, { target: { value: "1000" } })
    pressKey("Enter", field)

    expect(useCartStore.getState().itemDiscounts["line-1"]).toEqual({ type: "fixed", value: 1000 })
    expect(useCartStore.getState().getTotal()).toBe(5000)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // Unguarded, a barcode scanned there would be cut down to the line total and
  // its Enter would save it: the line given away for free.
  it("does not save a barcode scanned into the nominal discount field", () => {
    const onOpenChange = renderEditor(cartItem())
    const field = screen.getByRole("textbox", { name: "Nilai diskon" })

    scanInto(field, BARCODE)

    expect(field).toHaveValue("")
    expect(useCartStore.getState().itemDiscounts["line-1"]).toBeUndefined()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

describe("hold dialog (F3) name field", () => {
  it("holds the cart under a name typed by hand", async () => {
    renderPanel()
    fireEvent.keyDown(window, { key: "F3" })
    const dialog = await screen.findByRole("dialog", { name: "Simpan Transaksi" })
    const field = within(dialog).getByRole("textbox", { name: "Nama pelanggan" })

    fireEvent.change(field, { target: { value: "  Bu Sri  " } })
    fireEvent.submit(field.closest("form") as HTMLFormElement)

    await waitFor(() => expect(useCartStore.getState().heldCarts).toHaveLength(1))
    expect(useCartStore.getState().heldCarts[0].label).toBe("Bu Sri")
    expect(useCartStore.getState().items).toEqual([])
  })

  // Unguarded, the browser's implicit submit on the scan's Enter would park the
  // cart as "8991234567890", and the scanned item would never be added.
  it("does not hold the cart under a barcode scanned into the name field", async () => {
    renderPanel()
    fireEvent.keyDown(window, { key: "F3" })
    const dialog = await screen.findByRole("dialog", { name: "Simpan Transaksi" })
    const field = within(dialog).getByRole("textbox", { name: "Nama pelanggan" })

    const enter = scanInto(field, BARCODE)
    // What the browser does with an Enter in a one-field form nobody stopped.
    if (!enter.defaultPrevented) fireEvent.submit(field.closest("form") as HTMLFormElement)

    expect(enter.defaultPrevented).toBe(true)
    expect(field).toHaveValue("")
    expect(useCartStore.getState().heldCarts).toEqual([])
    expect(useCartStore.getState().items).toHaveLength(1)
  })
})

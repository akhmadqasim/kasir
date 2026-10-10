import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { installApiMock } from "@/test-utils/api-mock"
import { pressKey } from "@/test-utils/keyboard"
import { toast } from "@/lib/toast"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { useCartStore, type HeldCart } from "@/stores/cart-store"
import { CartPanel } from "./components/cart-panel"
import type { CartItem } from "./types"
import { formatRupiah } from "./utils"

/** The over-limit hint, with the spacing Testing Library normalises text to. */
function cappedHint(amount: number) {
  return `Melebihi belanja — dipotong jadi ${formatRupiah(amount)}`.replace(/\s+/g, " ")
}

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
    heldAt: Date.parse("2026-09-05T01:00:00Z"),
    ...overrides,
  }
}

// Beberapa test mengganti aksi store dengan `vi.fn()`; Zustand tidak mengembalikannya
// sendiri antar test, jadi aksi aslinya disimpan di sini dan dipasang kembali.
const { recallCart: realRecallCart, removeHeldCart: realRemoveHeldCart } = useCartStore.getState()

function resetStore(state: Partial<ReturnType<typeof useCartStore.getState>> = {}) {
  useCartStore.setState({
    items: [],
    heldCarts: [],
    itemDiscounts: {},
    transactionDiscount: null,
    ppobCounter: 0,
    recallCart: realRecallCart,
    removeHeldCart: realRemoveHeldCart,
    ...state,
  })
}

function renderPanel(props: Partial<Parameters<typeof CartPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <CartPanel onPay={() => {}} {...props} />
    </MemoryRouter>,
  )
}

/** Shortcut kasir selalu datang dari window, bukan dari elemen yang sedang fokus. */
function pressFunctionKey(key: string) {
  fireEvent.keyDown(window, { key })
}

/** Dialog transaksi tersimpan membaca tombol dari baris listbox yang fokus, bukan dari `window`. */
async function openHeldCartsDialog() {
  pressFunctionKey("F9")
  const dialog = await screen.findByRole("dialog")
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  return dialog
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

  it("shows the empty state inside the table, under its column headers", () => {
    renderPanel()

    expect(screen.getByText("Keranjang Kosong")).toBeInTheDocument()
    expect(screen.getByRole("grid", { name: "Isi keranjang" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Produk" })).toBeInTheDocument()
  })

  // Pintasannya ditulis sebagai `Kbd` di tombol yang memicunya, jadi ikut nama
  // aksesibelnya. Tiap tombol yang diklaim memang terikat — F4 di CashierPage,
  // sisanya di panel ini.
  it("labels each action button with its shortcut key", () => {
    resetStore({ items: [cartItem()] })
    useShiftStore.setState({ activeShift: { id: 1 } as never })
    renderPanel()

    for (const name of [
      "Uang F1",
      "Diskon F2",
      "Simpan F3",
      "Bayar F4",
      "Tutup F6",
      "Tersimpan F9",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument()
    }
  })

  it("says why Bayar is off when it is blocked", () => {
    resetStore({ items: [cartItem()] })
    renderPanel({ payBlockedReason: "Buka kasir dulu untuk menerima pembayaran." })

    const pay = screen.getByRole("button", { name: "Bayar F4" })
    expect(pay).toBeDisabled()
    expect(pay).toHaveAccessibleDescription("Buka kasir dulu untuk menerima pembayaran.")
  })

  it("opens the discount dialog on F2", async () => {
    resetStore({ items: [cartItem()] })
    renderPanel()

    pressFunctionKey("F2")

    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Diskon Total Transaksi")
  })

  it("shows the clamped percentage, with a hint only once it was clamped", async () => {
    resetStore({ items: [cartItem()] })
    renderPanel()

    pressFunctionKey("F2")
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: /Jenis diskon/ }))
    fireEvent.click(await screen.findByRole("option", { name: /Persen/ }))
    const field = within(dialog).getByRole("textbox", { name: "Nilai diskon (%)" })

    fireEvent.change(field, { target: { value: "50" } })
    expect(field).toHaveValue("50")
    expect(within(dialog).queryByText("Maksimal 100%")).not.toBeInTheDocument()

    fireEvent.change(field, { target: { value: "150" } })
    expect(field).toHaveValue("100")
    expect(within(dialog).getByText("Maksimal 100%")).toBeInTheDocument()
    expect(useCartStore.getState().transactionDiscount).toEqual({ type: "percentage", value: 100 })
  })

  it("shows a fixed discount cut down to the purchase, with the hint", async () => {
    // 2 × 3.000 = 6.000 to discount; 50.000 is shown as the 6.000 that applies
    // now, and saved whole so it applies in full once the cart grows.
    resetStore({ items: [cartItem()] })
    renderPanel()

    pressFunctionKey("F2")
    const dialog = await screen.findByRole("dialog")
    const field = within(dialog).getByRole("textbox", { name: "Nilai diskon" })

    fireEvent.change(field, { target: { value: "50000" } })

    expect(field).toHaveValue("6.000")
    expect(within(dialog).getByText(cappedHint(6000))).toBeInTheDocument()
    expect(useCartStore.getState().transactionDiscount).toEqual({ type: "fixed", value: 50000 })
    expect(useCartStore.getState().getTransactionDiscountAmount()).toBe(6000)
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
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Transaksi Tersimpan")

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

    await openHeldCartsDialog()

    // Sorotan mulai di baris pertama; satu panah bawah memindahkannya ke kedua.
    pressKey("ArrowDown")
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Pelanggan 2/ })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    )
    pressKey("Enter")

    expect(recallCart).toHaveBeenCalledWith("hold-2")
  })

  it("recalls a cart with one click on its row, but not from its Hapus button", async () => {
    const recallCart = vi.fn()
    const removeHeldCart = vi.fn()
    resetStore({
      heldCarts: [heldCart(), heldCart({ id: "hold-2", label: "Pelanggan 2" })],
    })
    useCartStore.setState({ recallCart, removeHeldCart })
    renderPanel()

    await openHeldCartsDialog()

    fireEvent.click(screen.getByRole("button", { name: "Hapus Pelanggan 2" }))
    expect(recallCart).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText("Pelanggan 2"))
    expect(recallCart).toHaveBeenCalledWith("hold-2")
  })

  it("recalls by its row number", async () => {
    const recallCart = vi.fn()
    resetStore({
      heldCarts: [heldCart(), heldCart({ id: "hold-2", label: "Pelanggan 2" })],
    })
    useCartStore.setState({ recallCart })
    renderPanel()

    await openHeldCartsDialog()

    pressKey("2")

    // A lone digit recalls once nothing follows it the way a scanner would.
    await waitFor(() => expect(recallCart).toHaveBeenCalledWith("hold-2"))
    // The Enter of someone confirming while the dialog animates shut is not a
    // second recall.
    pressKey("Enter")
    pressKey("1")
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(recallCart).toHaveBeenCalledTimes(1)
  })

  // The scanner is a keyboard: the next item scanned while F9 is open types
  // its barcode into the list. Its first digit used to recall that row, its
  // other digits and its Enter could recall again.
  it("never recalls a cart from a barcode scanned into the list", async () => {
    const recallCart = vi.fn()
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => {})
    resetStore({
      heldCarts: [heldCart(), heldCart({ id: "hold-2", label: "Pelanggan 2" })],
    })
    useCartStore.setState({ recallCart })
    renderPanel()

    await openHeldCartsDialog()
    const row = document.activeElement as HTMLElement
    const fireAt = (key: string, timeStamp: number) => {
      const event = createEvent.keyDown(row, { key })
      Object.defineProperty(event, "timeStamp", { value: timeStamp })
      fireEvent(row, event)
      return event
    }
    // "1" and "2" lead the barcode: both are row numbers on their own.
    const barcode = "1234567890128"
    for (let i = 0; i < barcode.length; i++) fireAt(barcode[i], 1000 + i * 10)
    const enter = fireAt("Enter", 1000 + barcode.length * 10 + 20)
    fireEvent.keyUp(row, { key: "Enter" })

    expect(enter.defaultPrevented).toBe(true)
    expect(warning).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(recallCart).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Transaksi Tersimpan")
    warning.mockRestore()
  })

  it("deletes the highlighted cart with Delete", async () => {
    const removeHeldCart = vi.fn()
    resetStore({
      heldCarts: [heldCart(), heldCart({ id: "hold-2", label: "Pelanggan 2" })],
    })
    useCartStore.setState({ removeHeldCart })
    renderPanel()

    await openHeldCartsDialog()

    pressKey("Delete")

    expect(removeHeldCart).toHaveBeenCalledWith("hold-1")
  })

  it("keeps the highlight on the row that takes the deleted one's place", async () => {
    resetStore({
      heldCarts: [
        heldCart(),
        heldCart({ id: "hold-2", label: "Pelanggan 2" }),
        heldCart({ id: "hold-3", label: "Pelanggan 3" }),
      ],
    })
    renderPanel()
    await openHeldCartsDialog()

    pressKey("ArrowDown")
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Pelanggan 2/ })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    )
    pressKey("Delete")

    // React Aria memfokuskan baris ketiga yang naik menggantikan yang dihapus;
    // sorotan dan fokus harus menunjuk baris yang sama.
    const next = await screen.findByRole("option", { name: /Pelanggan 3/ })
    await waitFor(() => expect(next).toHaveAttribute("aria-selected", "true"))
    expect(screen.queryByRole("option", { name: /Pelanggan 2/ })).not.toBeInTheDocument()
  })

  it("holds the cart under the automatic name when the name is left empty", async () => {
    resetStore({ items: [cartItem()] })
    renderPanel()

    pressFunctionKey("F3")
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveAccessibleName("Simpan Transaksi")
    expect(within(dialog).getByRole("textbox", { name: "Nama pelanggan" })).toHaveAttribute(
      "placeholder",
      "Pelanggan 1",
    )

    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan Transaksi" }))

    await waitFor(() => expect(useCartStore.getState().heldCarts).toHaveLength(1))
    expect(useCartStore.getState().heldCarts[0].label).toBe("Pelanggan 1")
    expect(useCartStore.getState().items).toHaveLength(0)
  })

  it("opens the line editor on F10 and closes it on the second press", async () => {
    resetStore({ items: [cartItem()] })
    renderPanel()

    pressFunctionKey("F10")
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Indomie Goreng")

    pressFunctionKey("F10")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("opens payment on F4", () => {
    const onPay = vi.fn()
    resetStore({ items: [cartItem()] })
    renderPanel({ onPay })

    pressFunctionKey("F4")

    expect(onPay).toHaveBeenCalledTimes(1)
  })

  it("does not open payment on F4 while one of its own dialogs is open", async () => {
    const onPay = vi.fn()
    resetStore({ items: [cartItem()] })
    renderPanel({ onPay })

    pressFunctionKey("F2")
    await screen.findByRole("dialog")
    pressFunctionKey("F4")

    expect(onPay).not.toHaveBeenCalled()
  })

  it("does not open payment on F4 while a page dialog covers the panel", () => {
    const onPay = vi.fn()
    resetStore({ items: [cartItem()] })
    renderPanel({ onPay, shortcutsDisabled: true })

    pressFunctionKey("F4")

    expect(onPay).not.toHaveBeenCalled()
  })

  it("removes a line without the trash button taking focus", () => {
    resetStore({ items: [cartItem(), cartItem({ cart_id: "line-2", product_name: "Beras 5kg" })] })
    render(<input aria-label="Kolom scan" />)
    renderPanel()
    const scanField = screen.getByRole("textbox", { name: "Kolom scan" })
    scanField.focus()

    const trash = screen.getByRole("button", { name: "Hapus Indomie Goreng" })
    // The browser focuses a pressed button between mousedown and click;
    // `preventFocusOnPress` has React Aria put focus straight back.
    fireEvent.mouseDown(trash, { button: 0 })
    trash.focus()
    expect(scanField).toHaveFocus()
    fireEvent.click(trash)

    expect(useCartStore.getState().items.map((item) => item.cart_id)).toEqual(["line-2"])
    expect(scanField).toHaveFocus()
  })

  it("saves a nominal transaction discount whole, capped only in the totals", async () => {
    resetStore({ items: [cartItem()] })
    renderPanel()

    pressFunctionKey("F2")
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Nilai diskon" }), {
      target: { value: "50000" },
    })

    // 2 × 3.000 = 6.000 in the cart: 6.000 comes off for now.
    expect(useCartStore.getState().transactionDiscount).toEqual({ type: "fixed", value: 50000 })
    expect(useCartStore.getState().getCartTotals().total).toBe(0)
  })

  // A cart discount typed early (10.000 on an 8.000 cart) must not stay 8.000
  // after more is scanned. The footer says when it is cut down for now.
  it("shows a footer hint while the cart discount is larger than the cart", () => {
    resetStore({
      items: [cartItem({ quantity: 2, product_price: 4000 })],
      transactionDiscount: { type: "fixed", value: 10000 },
    })
    const { unmount } = renderPanel()

    const hint = `Diskon dipotong jadi ${formatRupiah(8000)} (melebihi belanja)`.replace(
      /\s+/g,
      " ",
    )
    expect(screen.getByText(hint)).toBeInTheDocument()
    unmount()

    resetStore({
      items: [cartItem({ quantity: 4, product_price: 4000 })],
      transactionDiscount: { type: "fixed", value: 10000 },
    })
    renderPanel()
    expect(screen.queryByText(/Diskon dipotong jadi/)).not.toBeInTheDocument()
    expect(useCartStore.getState().getTransactionDiscountAmount()).toBe(10000)
  })
})

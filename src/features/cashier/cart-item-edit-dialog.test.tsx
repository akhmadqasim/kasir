import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { pressKey } from "@/test-utils/keyboard"
import { MAX_CART_QUANTITY, useCartStore } from "@/stores/cart-store"
import { CartItemEditDialog } from "./components/cart-item-edit-dialog"
import type { CartItem } from "./types"
import { formatRupiah } from "./utils"

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

function resetStore(state: Partial<ReturnType<typeof useCartStore.getState>> = {}) {
  useCartStore.setState({
    items: [],
    itemDiscounts: {},
    transactionDiscount: null,
    ...state,
  })
}

function renderDialog(item: CartItem) {
  const onOpenChange = vi.fn()
  render(<CartItemEditDialog open item={item} onOpenChange={onOpenChange} />)
  return onOpenChange
}

function qtyInput() {
  return screen.getByRole("textbox", { name: "Jumlah" })
}

/**
 * Pilih "Persen (%)" di Select "Jenis diskon". Diulang lewat `waitFor`, bukan
 * klik sekali: `usePress` React Aria sesekali tidak mendaftarkan klik pada
 * opsi popover yang baru saja terbuka saat suite-nya padat, dan percobaan
 * berikutnya tetap aman — kalau jenisnya sudah berpindah, assertion di dalam
 * langsung lolos tanpa menunggu percobaan lain.
 */
async function selectPercentageType() {
  await waitFor(() => {
    fireEvent.click(screen.getByRole("button", { name: /Jenis diskon$/ }))
    const option = screen.queryByRole("option", { name: "Persen (%)" })
    if (option) fireEvent.click(option)
    expect(screen.getByRole("textbox", { name: "Nilai diskon (%)" })).toBeInTheDocument()
  })
}

/** Nilai `<dd>` di sebelah label `<dt>` yang sama pada `SummaryList`. */
function summaryValue(label: string) {
  return screen.getByText(label).nextElementSibling?.textContent
}

beforeEach(() => {
  resetStore()
})

describe("cart item edit dialog", () => {
  it("focuses and selects the quantity field on open", async () => {
    const item = cartItem()
    resetStore({ items: [item] })
    renderDialog(item)

    await waitFor(() => expect(qtyInput()).toHaveFocus())
    expect(qtyInput()).toHaveValue("2")
  })

  it("steps the quantity with the +/- buttons and recomputes the total", () => {
    const item = cartItem()
    resetStore({ items: [item] })
    renderDialog(item)

    fireEvent.click(screen.getByRole("button", { name: /^Tambah jumlah/ }))

    expect(qtyInput()).toHaveValue("3")
    expect(summaryValue("Total")).toBe(formatRupiah(9000))
  })

  it("disables the decrement button at quantity 1", () => {
    const item = cartItem({ quantity: 1 })
    resetStore({ items: [item] })
    renderDialog(item)

    expect(screen.getByRole("button", { name: /^Kurangi jumlah/ })).toBeDisabled()
  })

  it("keeps the last valid quantity in the total while the field is emptied", () => {
    const item = cartItem()
    resetStore({ items: [item] })
    renderDialog(item)

    fireEvent.change(qtyInput(), { target: { value: "" } })

    expect(summaryValue("Total")).toBe(formatRupiah(6000))
  })

  it("saves the clamped quantity when Enter follows a scanned barcode in the field", () => {
    const item = cartItem()
    resetStore({ items: [item] })
    const onOpenChange = renderDialog(item)

    // 13 digit — panjang barcode EAN-13, bukan jumlah yang wajar.
    fireEvent.change(qtyInput(), { target: { value: "8991234567890" } })
    pressKey("Enter", qtyInput())

    expect(useCartStore.getState().items[0].quantity).toBe(MAX_CART_QUANTITY)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("hides the quantity field for a PPOB line", () => {
    const item = cartItem({ cart_id: "ppob-1", is_ppob: true })
    resetStore({ items: [item] })
    renderDialog(item)

    expect(screen.queryByRole("textbox", { name: "Jumlah" })).not.toBeInTheDocument()
  })

  it("labels the discount type select and swaps the value field when it changes", async () => {
    const item = cartItem()
    resetStore({ items: [item] })
    renderDialog(item)

    expect(screen.getByRole("textbox", { name: "Nilai diskon" })).toBeInTheDocument()

    await selectPercentageType()

    expect(screen.queryByRole("textbox", { name: "Nilai diskon" })).not.toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Nilai diskon (%)" })).toBeInTheDocument()
  })

  it("saves via Enter from the nominal discount field", () => {
    const item = cartItem()
    resetStore({ items: [item] })
    const onOpenChange = renderDialog(item)

    const discountInput = screen.getByRole("textbox", { name: "Nilai diskon" })
    fireEvent.change(discountInput, { target: { value: "500" } })
    pressKey("Enter", discountInput)

    expect(useCartStore.getState().itemDiscounts["line-1"]).toEqual({ type: "fixed", value: 500 })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("clamps a percentage discount to 100 on save", async () => {
    const item = cartItem()
    resetStore({ items: [item] })
    renderDialog(item)

    await selectPercentageType()
    const percentInput = screen.getByRole("textbox", { name: "Nilai diskon (%)" })
    fireEvent.change(percentInput, { target: { value: "150" } })
    // `NumberField` cuma meng-commit angka yang diketik saat kolomnya blur
    // (atau Enter) — persis seperti klik tombol lain di browser sungguhan.
    fireEvent.blur(percentInput)
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }))

    expect(useCartStore.getState().itemDiscounts["line-1"]).toEqual({
      type: "percentage",
      value: 100,
    })
  })

  it("shows Reset Diskon only once a discount is set, and clears it on press", () => {
    const item = cartItem()
    resetStore({
      items: [item],
      itemDiscounts: { "line-1": { type: "fixed", value: 500 } },
    })
    renderDialog(item)

    expect(screen.getByRole("button", { name: "Reset Diskon" })).toBeInTheDocument()
    expect(summaryValue("Diskon")).toBe(`-${formatRupiah(500)}`)

    fireEvent.click(screen.getByRole("button", { name: "Reset Diskon" }))

    expect(screen.queryByRole("button", { name: "Reset Diskon" })).not.toBeInTheDocument()
    expect(useCartStore.getState().itemDiscounts["line-1"]).toBeUndefined()
  })
})

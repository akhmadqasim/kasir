import { describe, expect, it } from "vitest"
import { escapeHtml, generateReceiptHtml } from "./print-receipt"
import type { ReceiptData } from "../types"

function makeReceiptData(overrides: Partial<ReceiptData> = {}): ReceiptData {
  return {
    store_name: "Toko Sembako Jaya",
    store_address: "Jl. Merdeka 1",
    store_phone: "08123456789",
    receipt_number: "TRX-20260905-0001",
    date_time: "05/09/2026 10:00",
    cashier_name: "Budi",
    items: [{ name: "Indomie Goreng", quantity: 2, price: 3000, subtotal: 6000 }],
    subtotal_amount: 6000,
    discount_amount: 0,
    total_amount: 6000,
    payment_method: "cash",
    payment_amount: 10000,
    change_amount: 4000,
    payment_breakdown: [],
    footer_text: null,
    notes: null,
    is_deleted: false,
    deleted_reason: null,
    deleted_by_name: null,
    original_total_amount: 6000,
    ...overrides,
  }
}

describe("escapeHtml", () => {
  it("escapes every character that can break out of markup", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;",
    )
  })
})

describe("generateReceiptHtml", () => {
  it("escapes a product name that contains markup", () => {
    const html = generateReceiptHtml(
      makeReceiptData({
        items: [
          {
            name: "<script>invoke('delete_backup')</script>",
            quantity: 1,
            price: 1000,
            subtotal: 1000,
          },
        ],
      }),
      58,
    )

    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("escapes store fields, notes and footer text", () => {
    const html = generateReceiptHtml(
      makeReceiptData({
        store_name: "<b>Toko</b>",
        store_address: "<i>Jalan</i>",
        store_phone: "<u>0812</u>",
        cashier_name: "<em>Budi</em>",
        notes: "<script>1</script>",
        footer_text: "<script>2</script>",
      }),
      58,
    )

    expect(html).not.toContain("<b>Toko</b>")
    expect(html).not.toContain("<i>Jalan</i>")
    expect(html).not.toContain("<u>0812</u>")
    expect(html).not.toContain("<em>Budi</em>")
    expect(html).not.toContain("<script>")
  })

  it("escapes a bank name coming from the payment breakdown", () => {
    const html = generateReceiptHtml(
      makeReceiptData({
        payment_method: "transfer",
        payment_breakdown: [
          { payment_method: "transfer", bank_name: "<script>3</script>", amount: 6000 },
        ],
      }),
      58,
    )

    expect(html).not.toContain("<script>")
  })

  it("renders subtotal and discount rows when a discount applies", () => {
    const html = generateReceiptHtml(
      makeReceiptData({
        subtotal_amount: 10000,
        discount_amount: 2000,
        total_amount: 8000,
        original_total_amount: 8000,
      }),
      58,
    )

    expect(html).toContain("<td>Subtotal</td>")
    expect(html).toContain("<td>Diskon</td>")
    expect(html).toContain("-2.000")
    expect(html).toContain("<td>TOTAL</td>")
  })

  it("omits the discount rows when nothing was discounted", () => {
    const html = generateReceiptHtml(makeReceiptData(), 58)

    expect(html).not.toContain("<td>Subtotal</td>")
    expect(html).not.toContain("<td>Diskon</td>")
  })

  // A split fully covered by QRIS drops its cash leg, so the sale is recorded as
  // plain "qris" with a single entry — while the cash on the counter still has to
  // be handed back. Keying the change row off "a cash entry exists" hid it.
  it("prints the change row for a sale with no cash entry left", () => {
    const html = generateReceiptHtml(
      makeReceiptData({
        payment_method: "qris",
        payment_amount: 6000,
        change_amount: 20000,
        payment_breakdown: [{ payment_method: "qris", bank_name: null, amount: 6000 }],
      }),
      58,
    )

    expect(html).toContain("<td>Kembalian</td>")
    expect(html).toContain("20.000")
  })

  it("omits the change row when there is nothing to hand back", () => {
    const html = generateReceiptHtml(
      makeReceiptData({
        payment_method: "qris",
        payment_amount: 6000,
        change_amount: 0,
        payment_breakdown: [{ payment_method: "qris", bank_name: null, amount: 6000 }],
      }),
      58,
    )

    expect(html).not.toContain("<td>Kembalian</td>")
  })
})

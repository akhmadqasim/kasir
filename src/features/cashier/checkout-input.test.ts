import { describe, expect, it } from "vitest"

import { buildCheckoutInput } from "./components/payment/checkout-input"
import type { CartItem } from "./types"

const goods: CartItem = {
  cart_id: "product-7",
  product_id: 7,
  product_name: "Beras 5kg",
  product_price: 75000,
  quantity: 2,
  stock: 10,
  unit: "sak",
  buy_price: 70000,
}

const ppob: CartItem = {
  cart_id: "ppob-1",
  product_name: "Token PLN - 20.000",
  product_price: 21500,
  quantity: 1,
  stock: 0,
  unit: "pcs",
  is_ppob: true,
  buy_price: 20500,
  service_type: "pln",
  service_ref: "123456789",
  ppob_product_id: 3,
  ppob_product_code: "PLN20",
  ppob_inquiry_id: "inq-1",
  ppob_payment_code: "pay-1",
  ppob_flag_id: "flag-1",
}

const cashPayment = { paymentMethod: "cash", paymentAmount: 200000, paymentBreakdown: undefined }

describe("buildCheckoutInput", () => {
  it("lets the server price a goods line and names a PPOB line itself", () => {
    const input = buildCheckoutInput({
      items: [goods, ppob],
      payment: cashPayment,
      itemDiscount: () => 0,
      transactionDiscount: 0,
      notes: "",
    })

    expect(input.items).toEqual([
      {
        product_id: 7,
        quantity: 2,
        product_name: undefined,
        product_price: undefined,
        buy_price: 70000,
        item_discount: undefined,
        service_type: undefined,
        service_ref: undefined,
        ppob_product_id: undefined,
        ppob_product_code: undefined,
        ppob_inquiry_id: undefined,
        ppob_payment_code: undefined,
        ppob_flag_id: undefined,
      },
      {
        product_id: undefined,
        quantity: 1,
        product_name: "Token PLN - 20.000",
        product_price: 21500,
        buy_price: 20500,
        item_discount: undefined,
        service_type: "pln",
        service_ref: "123456789",
        ppob_product_id: 3,
        ppob_product_code: "PLN20",
        ppob_inquiry_id: "inq-1",
        ppob_payment_code: "pay-1",
        ppob_flag_id: "flag-1",
      },
    ])
  })

  it("omits zero discounts, blank notes, the channel and the PIN when there are none", () => {
    const input = buildCheckoutInput({
      items: [goods],
      payment: cashPayment,
      itemDiscount: () => 0,
      transactionDiscount: 0,
      notes: "   ",
    })

    expect(input).toMatchObject({
      payment_method: "cash",
      payment_amount: 200000,
      payment_breakdown: undefined,
      transaction_discount: undefined,
      channel: undefined,
      notes: undefined,
      ppob_pin: undefined,
    })
  })

  it("carries discounts, trimmed notes, the breakdown, channel and PIN as given", () => {
    const breakdown = [{ payment_method: "qris", bank_name: "BCA", amount: 21500 }]
    const input = buildCheckoutInput({
      items: [goods],
      payment: { paymentMethod: "qris", paymentAmount: 21500, paymentBreakdown: breakdown },
      itemDiscount: () => 5000,
      transactionDiscount: 1000,
      channel: "ppob",
      notes: "  titip  ",
      ppobPin: "123456",
    })

    expect(input.items[0].item_discount).toBe(5000)
    expect(input).toMatchObject({
      payment_method: "qris",
      payment_amount: 21500,
      payment_breakdown: breakdown,
      transaction_discount: 1000,
      channel: "ppob",
      notes: "titip",
      ppob_pin: "123456",
    })
  })
})

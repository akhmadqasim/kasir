import { describe, expect, it } from "vitest"

import {
  EMPTY_PRODUCT_FORM,
  formFromProduct,
  generateSku,
  markupFromPrices,
  sellPriceFromMarkup,
  toCreateInput,
  toUpdateInput,
  validateProductForm,
  type ProductFormState,
} from "./product-form"
import type { Product } from "./types"

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 9,
    barcode: "8991002101036",
    sku: "TehBotol",
    name: "Teh Botol",
    category_id: 2,
    buy_price: 4000,
    sell_price: 5000,
    margin: 25,
    stock: 12,
    unit: "pcs",
    min_stock: 3,
    is_active: true,
    created_at: "2026-09-05 00:00:00",
    updated_at: "2026-09-05 00:00:00",
    ...overrides,
  }
}

function form(overrides: Partial<ProductFormState> = {}): ProductFormState {
  return {
    ...EMPTY_PRODUCT_FORM,
    name: "Gula Pasir 1kg",
    buyPrice: 14000,
    sellPrice: 16000,
    stock: "10",
    minStock: "2",
    ...overrides,
  }
}

describe("sellPriceFromMarkup", () => {
  it("adds the markup percent to the cost and rounds to whole rupiah", () => {
    expect(sellPriceFromMarkup(10000, 25)).toBe(12500)
    expect(sellPriceFromMarkup(3333, 10)).toBe(3666)
    expect(sellPriceFromMarkup(14000, 12.5)).toBe(15750)
  })

  it("has no answer until both cost and markup are positive", () => {
    expect(sellPriceFromMarkup(null, 10)).toBeNull()
    expect(sellPriceFromMarkup(0, 10)).toBeNull()
    expect(sellPriceFromMarkup(10000, null)).toBeNull()
    expect(sellPriceFromMarkup(10000, 0)).toBeNull()
    expect(sellPriceFromMarkup(10000, -5)).toBeNull()
  })
})

describe("markupFromPrices", () => {
  it("is the markup on cost, to two decimals", () => {
    expect(markupFromPrices(10000, 12500)).toBe(25)
    expect(markupFromPrices(3000, 4000)).toBe(33.33)
  })

  it("goes negative when the product sells below cost", () => {
    expect(markupFromPrices(10000, 9000)).toBe(-10)
  })

  it("has no answer while either price is empty or zero", () => {
    expect(markupFromPrices(null, 5000)).toBeNull()
    expect(markupFromPrices(0, 5000)).toBeNull()
    expect(markupFromPrices(5000, null)).toBeNull()
    expect(markupFromPrices(5000, 0)).toBeNull()
  })
})

describe("generateSku", () => {
  it("drops every whitespace run from the product name", () => {
    expect(generateSku("  Teh  Botol\tSosro ")).toBe("TehBotolSosro")
  })
})

describe("validateProductForm", () => {
  it("accepts a complete form", () => {
    expect(validateProductForm(form(), undefined)).toEqual({})
  })

  it("requires a name, a positive sell price and a non-negative cost", () => {
    const errors = validateProductForm(form({ name: "   ", sellPrice: 0, buyPrice: -1 }), undefined)
    expect(errors).toEqual({
      name: "Nama produk wajib diisi",
      sellPrice: "Harga jual harus lebih dari 0",
      buyPrice: "Harga modal tidak valid",
    })
  })

  it("treats an empty price field as missing", () => {
    const errors = validateProductForm(form({ sellPrice: null, buyPrice: null }), undefined)
    expect(errors.sellPrice).toBeDefined()
    expect(errors.buyPrice).toBeDefined()
  })

  it("allows a zero cost price", () => {
    expect(validateProductForm(form({ buyPrice: 0 }), undefined)).toEqual({})
  })

  it("requires a whole-number stock", () => {
    expect(validateProductForm(form({ stock: "" }), undefined).stock).toBe("Stok wajib diisi")
    expect(validateProductForm(form({ stock: "1.5" }), undefined).stock).toBe(
      "Stok harus bilangan bulat",
    )
  })

  it("rejects a typed negative stock on a new product", () => {
    expect(validateProductForm(form({ stock: "-2" }), undefined).stock).toBe(
      "Stok tidak boleh negatif",
    )
  })

  it("keeps a product that is already in the minus editable", () => {
    expect(validateProductForm(form({ stock: "-4" }), -4)).toEqual({})
    expect(validateProductForm(form({ stock: "-5" }), -4).stock).toBe("Stok tidak boleh negatif")
  })

  it("allows an empty minimum stock but not a fraction or a negative one", () => {
    expect(validateProductForm(form({ minStock: "" }), undefined)).toEqual({})
    expect(validateProductForm(form({ minStock: "2.5" }), undefined).minStock).toBeDefined()
    expect(validateProductForm(form({ minStock: "-1" }), undefined).minStock).toBeDefined()
  })
})

describe("toCreateInput", () => {
  it("trims text, turns empty optional fields into null and numbers into numbers", () => {
    expect(
      toCreateInput(
        form({ name: "  Gula  ", barcode: "  ", sku: " GL1 ", categoryId: "4", margin: 14.29 }),
      ),
    ).toEqual({
      name: "Gula",
      barcode: null,
      sku: "GL1",
      category_id: 4,
      buy_price: 14000,
      sell_price: 16000,
      margin: 14.29,
      stock: 10,
      unit: "pcs",
      min_stock: 2,
    })
  })

  it("sends no category and a zero minimum stock when they are left empty", () => {
    const input = toCreateInput(form({ categoryId: "", minStock: "" }))
    expect(input.category_id).toBeNull()
    expect(input.min_stock).toBe(0)
  })
})

describe("formFromProduct", () => {
  it("loads every field of the product for editing", () => {
    expect(formFromProduct(product())).toEqual({
      name: "Teh Botol",
      barcode: "8991002101036",
      sku: "TehBotol",
      skuManual: true,
      categoryId: "2",
      buyPrice: 4000,
      sellPrice: 5000,
      margin: 25,
      stock: "12",
      unit: "pcs",
      minStock: "3",
    })
  })

  it("derives the markup from the prices when none was stored", () => {
    expect(formFromProduct(product({ margin: 0 })).margin).toBe(25)
  })

  it("loads empty barcode, SKU and category as empty fields", () => {
    const loaded = formFromProduct(product({ barcode: null, sku: null, category_id: null }))
    expect(loaded).toMatchObject({ barcode: "", sku: "", categoryId: "" })
  })
})

describe("toUpdateInput", () => {
  it("leaves stock out when the cashier did not touch it, so sales since opening are kept", () => {
    const loaded = product()
    const input = toUpdateInput({ ...formFromProduct(loaded), sellPrice: 5500 }, loaded)
    expect(input).not.toHaveProperty("stock")
    expect(input).not.toHaveProperty("expected_stock")
    expect(input).toMatchObject({ id: 9, sell_price: 5500 })
  })

  it("sends an edited stock together with the stock the form was opened with", () => {
    const loaded = product()
    const input = toUpdateInput({ ...formFromProduct(loaded), stock: "20" }, loaded)
    expect(input).toMatchObject({ id: 9, stock: 20, expected_stock: 12 })
  })

  it("round-trips a product in the minus without sending its stock", () => {
    const loaded = product({ stock: -3 })
    const loadedForm = formFromProduct(loaded)
    expect(validateProductForm(loadedForm, loaded.stock)).toEqual({})
    expect(toUpdateInput(loadedForm, loaded)).not.toHaveProperty("stock")
  })
})

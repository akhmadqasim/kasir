import { id } from "@/i18n/id"
import type { CreateProductInput, Product, UpdateProductInput } from "./types"

/**
 * State, validation and request building for the add/edit product form — the
 * parts of `ProductFormDialog` that do not render anything.
 */

export const UNITS = ["pcs", "kg", "liter", "pack", "box", "karton", "lusin", "dus"].map(
  (unit) => ({ key: unit, label: unit }),
)

export interface ProductFormState {
  name: string
  barcode: string
  sku: string
  skuManual: boolean
  categoryId: string
  /** Rupiah bulat; `null` selama kolomnya kosong. */
  buyPrice: number | null
  sellPrice: number | null
  /** Persen, boleh pecahan; `null` selama kolomnya kosong. */
  margin: number | null
  stock: string
  unit: string
  minStock: string
}

export type ProductFormErrors = Partial<
  Record<"name" | "sellPrice" | "buyPrice" | "stock" | "minStock", string>
>

export const EMPTY_PRODUCT_FORM: ProductFormState = {
  name: "",
  barcode: "",
  sku: "",
  skuManual: false,
  categoryId: "",
  buyPrice: null,
  sellPrice: null,
  margin: null,
  stock: "",
  unit: "pcs",
  minStock: "",
}

/** Markup dalam persen dari harga modal ke harga jual, dua desimal. */
function markupPercent(buyPrice: number, sellPrice: number): number {
  return Math.round(((sellPrice - buyPrice) / buyPrice) * 10000) / 100
}

/** Harga jual dari modal dan markup; `null` bila salah satunya belum berarti. */
export function sellPriceFromMarkup(buyPrice: number | null, margin: number | null): number | null {
  if (buyPrice == null || buyPrice <= 0 || margin == null || margin <= 0) return null
  return Math.round(buyPrice * (1 + margin / 100))
}

/** Markup dari kedua harga; `null` bila salah satunya kosong atau nol. */
export function markupFromPrices(buyPrice: number | null, sellPrice: number | null): number | null {
  if (buyPrice == null || buyPrice <= 0 || sellPrice == null || sellPrice <= 0) return null
  return markupPercent(buyPrice, sellPrice)
}

export function generateSku(productName: string): string {
  return productName.trim().replace(/\s+/g, "")
}

export function formFromProduct(p: Product): ProductFormState {
  return {
    name: p.name,
    barcode: p.barcode || "",
    sku: p.sku || "",
    skuManual: true,
    categoryId: p.category_id ? String(p.category_id) : "",
    buyPrice: p.buy_price,
    sellPrice: p.sell_price,
    margin: p.margin || markupFromPrices(p.buy_price, p.sell_price),
    stock: String(p.stock),
    unit: p.unit,
    minStock: String(p.min_stock),
  }
}

/**
 * @param loadedStock the stock the edit form was opened with, or `undefined`
 *   when adding a product.
 */
export function validateProductForm(
  form: ProductFormState,
  loadedStock: number | undefined,
): ProductFormErrors {
  const errors: ProductFormErrors = {}
  if (!form.name.trim()) errors.name = id.validation.productNameRequired
  if (form.sellPrice == null || form.sellPrice <= 0)
    errors.sellPrice = id.validation.sellPricePositive
  if (form.buyPrice == null || form.buyPrice < 0) errors.buyPrice = id.validation.buyPriceInvalid
  // Stock is an INTEGER column: "1.5" used to pass here and fail on the server.
  const stock = Number(form.stock)
  if (form.stock.trim() === "") errors.stock = id.validation.stockRequired
  else if (!Number.isInteger(stock)) errors.stock = id.validation.stockInteger
  // A product already in the minus (sold before it was received) must stay
  // editable: its untouched stock is not sent at all, so only block a value
  // the cashier actually typed.
  else if (stock < 0 && stock !== loadedStock) errors.stock = id.validation.stockNegative
  const minStock = Number(form.minStock)
  if (form.minStock.trim() !== "" && (!Number.isInteger(minStock) || minStock < 0))
    errors.minStock = id.validation.minStockInteger
  return errors
}

export function toCreateInput(form: ProductFormState): CreateProductInput {
  return {
    name: form.name.trim(),
    barcode: form.barcode.trim() || null,
    sku: form.sku.trim() || null,
    category_id: form.categoryId ? Number(form.categoryId) : null,
    buy_price: form.buyPrice ?? 0,
    sell_price: form.sellPrice ?? 0,
    margin: form.margin ?? 0,
    stock: Number(form.stock),
    unit: form.unit,
    min_stock: form.minStock ? Number(form.minStock) : 0,
  }
}

/**
 * The stock the form loaded goes stale as sales keep landing, so it is sent
 * only when edited — with the loaded value, so the server applies the
 * difference on top of the current stock.
 */
export function toUpdateInput(form: ProductFormState, product: Product): UpdateProductInput {
  const { stock, ...rest } = toCreateInput(form)
  return stock === product.stock
    ? { ...rest, id: product.id }
    : { ...rest, id: product.id, stock, expected_stock: product.stock }
}

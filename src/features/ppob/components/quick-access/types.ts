import type { QuickAccessServiceKey } from "../../constants"

export type ServiceType = QuickAccessServiceKey

/**
 * Resolves the price the customer is charged. The confirmation panel and the
 * cart both read this same value, so what is shown is what is charged.
 */
export type ResolveSellPrice = (input: {
  name: string
  serviceType: string
  vendorCost: number
}) => number

/** Satu baris PPOB yang diserahkan ke keranjang; setiap layanan mengisi sebagian. */
export interface AddToCartItem {
  name: string
  /** Final sell price, already resolved by the caller via resolveSellPrice */
  price: number
  service_type: string
  service_ref: string
  /** What the store pays the vendor — bill plus admin fee for bill payments */
  buy_price?: number
  ppob_product_id?: number
  ppob_product_code?: string
  ppob_inquiry_id?: string
  ppob_payment_code?: string
  ppob_flag_id?: string
}

export interface ServiceInputProps {
  onAddToCart: (item: AddToCartItem) => void
  resolveSellPrice: ResolveSellPrice
  wideLayout?: boolean
}

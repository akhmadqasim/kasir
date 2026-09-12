// One sold line has a single declaration, in the feature that owns transaction
// history. Re-exported here so checkout keeps its own import surface.
import type { TransactionItem } from "@/features/transactions/types"

export type { TransactionItem }

export interface CartItem {
  cart_id: string
  product_id?: number
  product_name: string
  product_price: number
  quantity: number
  stock: number
  unit: string
  is_ppob?: boolean
  service_type?: string
  service_ref?: string
  buy_price?: number
  sell_price?: number
  ppob_product_id?: number
  ppob_product_code?: string
  ppob_inquiry_id?: string
  ppob_payment_code?: string
  ppob_flag_id?: string
}

export interface TransactionItemInput {
  product_id?: number
  quantity: number
  product_name?: string
  product_price?: number
  buy_price?: number
  item_discount?: number
  service_type?: string
  service_ref?: string
  ppob_product_id?: number
  ppob_product_code?: string
  ppob_inquiry_id?: string
  ppob_payment_code?: string
  ppob_flag_id?: string
}

export interface PaymentSplitInput {
  payment_method: string
  bank_name?: string
  amount: number
}

/**
 * The cashier is not named here. The sale is booked against whoever's session
 * sends it — the old command took a `user_id` from the payload and believed it.
 */
export interface CheckoutTransactionInput {
  items: TransactionItemInput[]
  payment_method: string
  payment_amount: number
  payment_breakdown?: PaymentSplitInput[]
  notes?: string
  transaction_discount?: number
  shift_id?: number
}

export interface PaymentSplit {
  payment_method: string
  bank_name?: string | null
  amount: number
}

export interface Transaction {
  id: number
  receipt_number: string
  user_id: number
  total_amount: number
  subtotal_amount: number
  discount_amount: number
  payment_method: string
  payment_amount: number
  change_amount: number
  status: string
  notes: string | null
  deleted_at: string | null
  deleted_by: number | null
  deleted_reason: string | null
  updated_at: string | null
  created_at: string
}

export interface TransactionResult {
  transaction: Transaction
  items: TransactionItem[]
  payment_breakdown: PaymentSplit[]
}

export interface PaymentSplit {
  payment_method: string
  bank_name?: string | null
  amount: number
}

export interface TransactionListItem {
  id: number
  receipt_number: string
  user_id: number
  cashier_name: string
  total_amount: number
  subtotal_amount: number
  discount_amount: number
  payment_method: string
  payment_amount: number
  change_amount: number
  status: string
  item_count: number
  notes: string | null
  created_at: string | null
  has_ppob: boolean
  ppob_status: string | null
  ppob_message: string | null
  ppob_serial_number: string | null
  deleted_at: string | null
  deleted_reason: string | null
  payment_breakdown: PaymentSplit[]
}

export interface PaginatedTransactions {
  data: TransactionListItem[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

/**
 * One sold line, mirroring `entity::transaction_items::Model`.
 *
 * This is the only declaration of the shape — `features/cashier/types.ts`
 * re-exports it. Two hand-written copies had already drifted apart (`net_subtotal`
 * missing from both, `ppob_flag_id` missing from this one), which is exactly how a
 * backend column ends up rendered on one screen and ignored on the next.
 */
export interface TransactionItem {
  id: number
  transaction_id: number
  product_id: number | null
  product_name: string
  product_price: number
  buy_price: number | null
  quantity: number
  subtotal: number
  item_discount: number
  /**
   * Rupiah actually paid for this line: `subtotal` minus `item_discount`, minus
   * this line's share of the transaction-level discount. Summing it over a
   * transaction gives `total_amount`, so it — not `product_price * quantity` —
   * is what a line must display and what a refund must pay back.
   */
  net_subtotal: number
  service_type: string | null
  service_ref: string | null
  ppob_product_id: number | null
  ppob_product_code: string | null
  ppob_inquiry_id: string | null
  ppob_payment_code: string | null
  ppob_flag_id: string | null
  ppob_status: string | null
  ppob_message: string | null
  ppob_serial_number: string | null
  created_at: string | null
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
  change_amount: number | null
  status: string
  notes: string | null
  deleted_at: string | null
  deleted_by: number | null
  deleted_reason: string | null
  updated_at: string | null
  created_at: string | null
}

export interface TransactionDetail {
  transaction: Transaction
  items: TransactionItem[]
  cashier_name: string
  has_ppob: boolean
  ppob_status: string | null
  ppob_message: string | null
  ppob_serial_number: string | null
  payment_breakdown: PaymentSplit[]
}

export interface ListTransactionsInput {
  page?: number
  per_page?: number
  date_from?: string
  date_to?: string
  payment_method?: string
  status?: string
  search?: string
}

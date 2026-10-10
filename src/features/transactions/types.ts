/**
 * Which screen rang the sale up. `sales` is the cashier's cart — goods, with
 * PPOB lines mixed in when the cashier sells them there. `ppob` is a purchase
 * completed on the PPOB page itself: a real sale (same receipt, same shift
 * drawer) that the sales history, the reports and the dashboard leave out.
 * Mirrors `CHANNEL_*` in `services/transactions/mod.rs`.
 */
export type TransactionChannel = "sales" | "ppob"

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
  channel: TransactionChannel
  item_count: number
  notes: string | null
  created_at: string | null
  /**
   * Some line still has units a refund may take back, as the server computes
   * it. The status cannot say it: a mixed cart whose goods all came back stays
   * `partial_refund`, because its PPOB line was not reversed.
   */
  has_refundable_goods: boolean
  /**
   * A failed PPOB line still has money to give back. That refund has no
   * seven-day window, so the row keeps offering it after goods stopped.
   */
  has_refundable_failed_ppob: boolean
  has_ppob: boolean
  /**
   * The PPOB line that most needs a person (`uncertain`, then `failed`, then
   * one in flight), not merely the first; the next two fields are that line's.
   */
  ppob_status: string | null
  ppob_message: string | null
  ppob_serial_number: string | null
  ppob_service_type: string | null
  ppob_advice: string | null
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
  /**
   * Mitra's references from an `ADVICE` answer, as JSON text. Set exactly when
   * Mitra said the payment went to the biller and its result comes later
   * (`{}` when the references are unknown); see migration 031.
   */
  ppob_advice?: string | null
  /**
   * When the last retry of this line went out (UTC, `YYYY-MM-DD HH:MM:SS`);
   * `null` until a retry. With `created_at` it starts the 24-hour wait before
   * an ADVICE line may be marked failed by hand (migration 032).
   */
  ppob_last_attempt_at?: string | null
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
  channel: TransactionChannel
  notes: string | null
  deleted_at: string | null
  deleted_by: number | null
  deleted_reason: string | null
  updated_at: string | null
  created_at: string | null
}

/**
 * A sold line as `GET /transactions/:id` returns it: the row plus its refund
 * state, computed by the server. `refundable` says whether the line can come
 * back at all (goods, or a failed PPOB top-up); `refundable_quantity` is what is
 * left of it, the cap `create_refund` enforces.
 */
export interface TransactionDetailItem extends TransactionItem {
  refunded_quantity: number
  refundable: boolean
  refundable_quantity: number
  /**
   * When "Tandai Gagal" opens for an ADVICE line (UTC, `YYYY-MM-DD HH:MM:SS`),
   * as the server computes it; `null` when there is no wait.
   */
  ppob_manual_fail_opens_at: string | null
}

export interface TransactionDetail {
  transaction: Transaction
  items: TransactionDetailItem[]
  cashier_name: string
  /** Same as `TransactionListItem.has_refundable_goods`. */
  has_refundable_goods: boolean
  /** Same as `TransactionListItem.has_refundable_failed_ppob`. */
  has_refundable_failed_ppob: boolean
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
  /** Omitted = every channel; the history page asks for `sales`. */
  channel?: TransactionChannel
  search?: string
}

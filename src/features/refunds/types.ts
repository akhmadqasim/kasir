/**
 * One returned line. The product is deliberately absent: the backend derives it
 * from `transaction_item_id`, which it checks against the lines of the
 * transaction being refunded. A client-chosen `product_id` used to let a refund
 * restore stock for an item that was never sold, so `create_refund` now ignores
 * the field entirely.
 */
export interface RefundItemInput {
  transaction_item_id: number
  quantity: number
  condition: "good" | "damaged" | "expired"
}

export interface ExchangeItemInput {
  product_id: number
  quantity: number
}

export interface CreateRefundInput {
  transaction_id: number
  user_id: number
  reason?: string
  items: RefundItemInput[]
  exchange_items?: ExchangeItemInput[]
}

export interface RefundModel {
  id: number
  refund_number: string
  transaction_id: number
  user_id: number
  refund_type: string
  total_refund_amount: number
  total_exchange_amount: number | null
  difference_amount: number | null
  payment_method: string | null
  reason: string | null
  created_at: string | null
}

export interface RefundItemModel {
  id: number
  refund_id: number
  transaction_item_id: number
  product_id: number
  quantity: number
  subtotal: number
  condition: string | null
  created_at: string | null
}

export interface ExchangeItemModel {
  id: number
  refund_id: number
  product_id: number
  product_name: string
  product_price: number
  quantity: number
  subtotal: number
  created_at: string | null
}

export interface RefundResult {
  refund: RefundModel
  items: RefundItemModel[]
  exchange_items: ExchangeItemModel[]
}

// List/History types
export interface RefundListItem {
  id: number
  refund_number: string
  refund_type: string
  transaction_receipt: string
  cashier_name: string
  total_refund_amount: number
  total_exchange_amount: number
  difference_amount: number
  created_at: string | null
}

export interface ListRefundsResult {
  items: RefundListItem[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

// Detail types
export interface RefundDetailItem {
  id: number
  product_name: string
  product_price: number
  quantity: number
  subtotal: number
  condition: string | null
}

export interface ExchangeDetailItem {
  id: number
  product_name: string
  product_price: number
  quantity: number
  subtotal: number
}

export interface RefundDetailResult {
  refund: RefundModel
  items: RefundDetailItem[]
  exchange_items: ExchangeDetailItem[]
  transaction_receipt: string
  cashier_name: string
}

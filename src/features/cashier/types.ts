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
}

export interface CheckoutTransactionInput {
  user_id: number
  items: TransactionItemInput[]
  payment_method: string
  payment_amount: number
  notes?: string
  transaction_discount?: number
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
  created_at: string
}

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
  service_type: string | null
  service_ref: string | null
  ppob_product_id: number | null
  ppob_product_code: string | null
  ppob_inquiry_id: string | null
  ppob_payment_code: string | null
  ppob_status: string | null
  ppob_message: string | null
  ppob_serial_number: string | null
  created_at: string | null
}

export interface TransactionResult {
  transaction: Transaction
  items: TransactionItem[]
}

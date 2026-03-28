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
  ppob_product_code?: string
}

export interface TransactionItemInput {
  product_id?: number
  quantity: number
  product_name?: string
  product_price?: number
  buy_price?: number
  service_type?: string
  service_ref?: string
}

export interface CreateTransactionInput {
  user_id: number
  items: TransactionItemInput[]
  payment_method: string
  payment_amount: number
  notes?: string
}

export interface Transaction {
  id: number
  receipt_number: string
  user_id: number
  total_amount: number
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
  service_type: string | null
  service_ref: string | null
  created_at: string
}

export interface TransactionResult {
  transaction: Transaction
  items: TransactionItem[]
}

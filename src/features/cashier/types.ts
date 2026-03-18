export interface CartItem {
  product_id: number
  product_name: string
  product_price: number
  quantity: number
  stock: number
  unit: string
}

export interface TransactionItemInput {
  product_id: number
  quantity: number
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
  product_id: number
  product_name: string
  product_price: number
  quantity: number
  subtotal: number
  created_at: string
}

export interface TransactionResult {
  transaction: Transaction
  items: TransactionItem[]
}

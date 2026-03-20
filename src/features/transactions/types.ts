export interface TransactionListItem {
  id: number
  receipt_number: string
  user_id: number
  cashier_name: string
  total_amount: number
  payment_method: string
  payment_amount: number
  change_amount: number
  status: string
  item_count: number
  notes: string | null
  created_at: string | null
}

export interface PaginatedTransactions {
  data: TransactionListItem[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface TransactionItem {
  id: number
  transaction_id: number
  product_id: number
  product_name: string
  product_price: number
  quantity: number
  subtotal: number
  created_at: string | null
}

export interface Transaction {
  id: number
  receipt_number: string
  user_id: number
  total_amount: number
  payment_method: string
  payment_amount: number
  change_amount: number | null
  status: string
  notes: string | null
  created_at: string | null
}

export interface TransactionDetail {
  transaction: Transaction
  items: TransactionItem[]
  cashier_name: string
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

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
  has_ppob: boolean
  ppob_status: string | null
  ppob_message: string | null
  ppob_serial_number: string | null
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
  product_id: number | null
  product_name: string
  product_price: number
  buy_price: number | null
  quantity: number
  subtotal: number
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
  has_ppob: boolean
  ppob_status: string | null
  ppob_message: string | null
  ppob_serial_number: string | null
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

export interface ReceiptData {
  store_name: string
  store_address: string | null
  store_phone: string | null
  receipt_number: string
  date_time: string
  cashier_name: string
  items: ReceiptItem[]
  subtotal_amount: number
  discount_amount: number
  total_amount: number
  payment_method: string
  payment_amount: number
  change_amount: number
  payment_breakdown: ReceiptPaymentSplit[]
  footer_text: string | null
  notes: string | null
  is_deleted: boolean
  deleted_reason: string | null
  deleted_by_name: string | null
  original_total_amount: number
}

export interface ReceiptItem {
  name: string
  quantity: number
  price: number
  subtotal: number
}

export interface ReceiptPaymentSplit {
  payment_method: string
  bank_name?: string | null
  amount: number
}

export interface ReceiptData {
  store_name: string
  store_address: string | null
  store_phone: string | null
  receipt_number: string
  date_time: string
  cashier_name: string
  items: ReceiptItem[]
  total_amount: number
  payment_method: string
  payment_amount: number
  change_amount: number
  footer_text: string | null
  notes: string | null
}

export interface ReceiptItem {
  name: string
  quantity: number
  price: number
  subtotal: number
}

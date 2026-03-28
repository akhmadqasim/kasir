export interface InquiryResult {
  inquiryId: string
  customerName: string | null
  customerId: string
  productName: string | null
  amount: number
  adminFee: number
  total: number
  serviceType: string
  rawData: Record<string, unknown>
}

export interface PaymentResult {
  success: boolean
  receiptData: Record<string, unknown>
  serviceType: string
  customerId: string
  amount: number
  adminFee: number
  total: number
  productName: string | null
  customerName: string | null
  serialNumber: string | null
}

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

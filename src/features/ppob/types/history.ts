export interface HistoryPaymentItem {
  trxId: string | null
  inquiryId: string | null
  productName: string | null
  description: string | null
  serialNumber: string | null
  total: number | null
  amount: number | null
  adminFee: number | null
  status: string | null
  createdAt: string | null
  vendorPrice: number | null
  basePrice: number | null
  sellPrice: number | null
  profit: number | null
  margin: number | null
  denom: string | null
  provider: string | null
  merchant: string | null
  plu: string | null
  serviceType: string | null
  customerNo: string | null
  tokenNumber: string | null
  paymentCode: string | null
  receiptText: string | null
  invoiceUrl: string | null
  igrDesc: string | null
  noRef: string | null
}

export interface HistoryDetailItem {
  trxId: string | null
  productName: string | null
  description: string | null
  serialNumber: string | null
  total: number | null
  amount: number | null
  adminFee: number | null
  status: string | null
  createdAt: string | null
  customerNo: string | null
  customerName: string | null
  reference: string | null
  paymentCode: string | null
  serviceType: string | null
  provider: string | null
  denom: string | null
  sellPrice: number | null
  basePrice: number | null
  profit: number | null
}

export interface MutasiItem {
  id: string | null
  mutationType: "in" | "out"
  description: string | null
  amount: number | null
  status: string | null
  createdAt: string | null
  paymentMethod: string | null
  reference: string | null
  rawData: Record<string, unknown>
}

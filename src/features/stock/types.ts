export interface StockWriteoff {
  id: number
  writeoffNumber: string
  productId: number
  productName: string
  userId: number
  cashierName: string
  quantity: number
  reason: string
  lossValue: number
  notes: string | null
  approvedBy: number | null
  approverName: string | null
  status: string
  refundId: number | null
  createdAt: string
}

export interface CreateStockWriteoffInput {
  productId: number
  quantity: number
  reason: string
  notes?: string
}

export interface ListWriteoffsParams {
  page?: number
  perPage?: number
  status?: string
  reason?: string
  dateFrom?: string
  dateTo?: string
}

export interface ListWriteoffsResult {
  items: StockWriteoff[]
  total: number
  page: number
  perPage: number
  totalPages: number
}

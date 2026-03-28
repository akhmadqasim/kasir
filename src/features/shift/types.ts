export interface Shift {
  id: number
  userId: number
  userName: string
  openingCash: number
  closingCash: number | null
  openedAt: string
  closedAt: string | null
  notes: string | null
  status: "open" | "closed"
}

export interface CashFlow {
  id: number
  shiftId: number
  userId: number
  flowType: "in" | "out"
  amount: number
  description: string
  createdAt: string | null
}

export interface PaymentBreakdown {
  method: string
  count: number
  total: number
}

export interface ShiftSummary {
  shift: Shift
  totalSales: number
  totalTransactions: number
  cashIn: number
  cashOut: number
  expectedCash: number
  cashFlows: CashFlow[]
  paymentBreakdown: PaymentBreakdown[]
}

export interface OpenShiftInput {
  userId: number
  openingCash?: number
}

export interface CloseShiftInput {
  shiftId: number
  closingCash?: number
  notes?: string
}

export interface CreateCashFlowInput {
  shiftId: number
  userId: number
  flowType: "in" | "out"
  amount: number
  description: string
}

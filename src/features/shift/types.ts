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
  /**
   * Cash handed back over the counter for returns taken during this shift,
   * already subtracted from `expectedCash`. Shown as its own line because a
   * drawer count has to explain where the money went, not merely come out short.
   */
  cashRefunds: number
  expectedCash: number
  cashFlows: CashFlow[]
  /**
   * One row per method that actually took money. A shift paid entirely by QRIS
   * produces no cash row at all, so a screen has to cope with its absence rather
   * than assume the list has one.
   */
  paymentBreakdown: PaymentBreakdown[]
}

/** Opening a shift names no user: it opens *your* shift, taken from the session. */
export interface OpenShiftInput {
  openingCash?: number
}

export interface CloseShiftInput {
  shiftId: number
  closingCash?: number
  notes?: string
}

/** The author is the session, so there is no `userId` to send. */
export interface CreateCashFlowInput {
  shiftId: number
  flowType: "in" | "out"
  amount: number
  description: string
}

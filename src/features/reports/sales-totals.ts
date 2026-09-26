/** The figures every sales row carries, whether it is a day or a month. */
export interface SalesFigures {
  transactionCount: number
  totalRevenue: number
  totalCost: number
  grossProfit: number
}

export interface SalesTotals {
  transactions: number
  revenue: number
  cost: number
  profit: number
}

export function sumSalesRows(rows: readonly SalesFigures[]): SalesTotals {
  return rows.reduce(
    (acc, row) => ({
      transactions: acc.transactions + row.transactionCount,
      revenue: acc.revenue + row.totalRevenue,
      cost: acc.cost + row.totalCost,
      profit: acc.profit + row.grossProfit,
    }),
    { transactions: 0, revenue: 0, cost: 0, profit: 0 },
  )
}

/**
 * Report figures are net of returns, so profit can go negative — a loss must not
 * read as a green number, neither in a row nor on the summary card.
 */
export function profitTone(profit: number): "success" | "danger" {
  return profit < 0 ? "danger" : "success"
}

export function profitToneClass(profit: number): string {
  return profit < 0 ? "text-danger" : "text-success"
}

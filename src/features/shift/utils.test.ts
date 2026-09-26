import { describe, expect, it } from "vitest"

import { netCashFlowItem, withoutCashFlow } from "./utils"
import type { CashFlow, ShiftSummary } from "./types"

const CASH_IN: CashFlow = {
  id: 1,
  shiftId: 9,
  userId: 1,
  flowType: "in",
  amount: 50_000,
  description: "Tambahan modal",
  createdAt: null,
}

const CASH_OUT: CashFlow = { ...CASH_IN, id: 2, flowType: "out", amount: 20_000 }

const SUMMARY: ShiftSummary = {
  shift: {
    id: 9,
    userId: 1,
    userName: "Admin",
    openingCash: 200_000,
    closingCash: null,
    openedAt: "2026-09-05 01:00:00",
    closedAt: null,
    notes: null,
    status: "open",
  },
  totalSales: 750_000,
  totalTransactions: 12,
  cashIn: 50_000,
  cashOut: 20_000,
  cashRefunds: 0,
  // 200.000 modal + 750.000 tunai + 50.000 masuk - 20.000 keluar
  expectedCash: 980_000,
  cashFlows: [CASH_IN, CASH_OUT],
  paymentBreakdown: [{ method: "cash", count: 12, total: 750_000 }],
}

/**
 * Menghapus arus kas di layar harus memberi angka yang sama dengan yang akan
 * dihitung server sesudahnya, supaya muat ulang yang gagal tidak meninggalkan
 * saldo yang salah.
 */
describe("withoutCashFlow", () => {
  it("menghapus uang keluar: saldo aplikasi naik kembali", () => {
    const next = withoutCashFlow(SUMMARY, CASH_OUT)

    expect(next.cashFlows).toEqual([CASH_IN])
    expect(next.cashIn).toBe(50_000)
    expect(next.cashOut).toBe(0)
    expect(next.expectedCash).toBe(1_000_000)
  })

  it("menghapus uang masuk: saldo aplikasi turun", () => {
    const next = withoutCashFlow(SUMMARY, CASH_IN)

    expect(next.cashFlows).toEqual([CASH_OUT])
    expect(next.cashIn).toBe(0)
    expect(next.cashOut).toBe(20_000)
    expect(next.expectedCash).toBe(930_000)
  })

  it("tidak mengubah apa pun untuk entri yang sudah tidak ada", () => {
    const next = withoutCashFlow(SUMMARY, { ...CASH_IN, id: 99 })

    expect(next).toBe(SUMMARY)
  })
})

describe("netCashFlowItem", () => {
  it("memberi tanda dan warna sesuai arah totalnya", () => {
    expect(netCashFlowItem(SUMMARY)).toMatchObject({ label: "Total", tone: "success" })
    expect(netCashFlowItem({ ...SUMMARY, cashIn: 0 })).toMatchObject({ tone: "danger" })
  })
})

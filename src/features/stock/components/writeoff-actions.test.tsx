import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { WriteoffActions } from "./writeoff-actions"
import type { StockWriteoff } from "../types"

const PENDING: StockWriteoff = {
  id: 7,
  writeoffNumber: "WO-20260926-0001",
  productId: 3,
  productName: "Minyak Goreng 1L",
  userId: 2,
  cashierName: "Kasir Satu",
  quantity: 2,
  reason: "damaged",
  lossValue: 30000,
  notes: null,
  approvedBy: null,
  approverName: null,
  status: "pending",
  refundId: null,
  createdAt: "2026-09-26 03:00:00",
}

const NO = PENDING.writeoffNumber

describe("WriteoffActions", () => {
  it("gives an admin approve, reject and delete on a pending write-off", () => {
    const onAction = vi.fn()
    render(<WriteoffActions writeoff={PENDING} isAdmin onAction={onAction} />)

    fireEvent.click(screen.getByRole("button", { name: `Setujui ${NO}` }))
    fireEvent.click(screen.getByRole("button", { name: `Tolak ${NO}` }))
    fireEvent.click(screen.getByRole("button", { name: `Hapus ${NO}` }))

    expect(onAction.mock.calls.map(([a]) => a.type)).toEqual(["approve", "reject", "delete"])
    expect(onAction.mock.calls[0][0].writeoff).toBe(PENDING)
  })

  it("hides delete for a write-off that came from a refund", () => {
    render(<WriteoffActions writeoff={{ ...PENDING, refundId: 4 }} isAdmin onAction={() => {}} />)
    expect(screen.getByRole("button", { name: `Tolak ${NO}` })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: `Hapus ${NO}` })).toBeNull()
  })

  it("shows no actions to a cashier", () => {
    render(<WriteoffActions writeoff={PENDING} isAdmin={false} onAction={() => {}} />)
    expect(screen.queryAllByRole("button")).toHaveLength(0)
    expect(screen.getByText("Tidak ada aksi")).toBeInTheDocument()
  })

  it("shows no actions once a write-off is decided", () => {
    render(
      <WriteoffActions writeoff={{ ...PENDING, status: "approved" }} isAdmin onAction={() => {}} />,
    )
    expect(screen.queryAllByRole("button")).toHaveLength(0)
  })
})

import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"

import { id } from "@/i18n/id"
import { WriteoffConfirmDialog, type WriteoffAction } from "./components/writeoff-confirm-dialog"
import type { StockWriteoff } from "./types"

const WRITEOFF: StockWriteoff = {
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

function renderDialog(action: WriteoffAction) {
  render(
    <WriteoffConfirmDialog
      isOpen
      action={action}
      isPending={false}
      onConfirm={() => {}}
      onOpenChange={() => {}}
    />,
  )
  return within(screen.getByRole("alertdialog"))
}

describe("WriteoffConfirmDialog", () => {
  it("spells out what rejecting does to the stock, with the row's details", () => {
    const dialog = renderDialog({ type: "reject", writeoff: WRITEOFF })

    expect(dialog.getByText(id.writeoff.confirm.rejectTitle)).toBeInTheDocument()
    expect(dialog.getByText(id.writeoff.confirm.rejectBody)).toBeInTheDocument()
    expect(dialog.getByText(id.writeoff.confirm.number)).toBeInTheDocument()
    expect(dialog.getByText("WO-20260926-0001")).toBeInTheDocument()
    expect(
      dialog.getByRole("button", { name: id.writeoff.confirm.rejectAction }),
    ).toBeInTheDocument()
  })

  it("says a refund-originated write-off gives no stock back", () => {
    const dialog = renderDialog({ type: "reject", writeoff: { ...WRITEOFF, refundId: 4 } })

    expect(dialog.getByText(id.writeoff.confirm.rejectFromRefundBody)).toBeInTheDocument()
  })
})

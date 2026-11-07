import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import type { TransactionDetail } from "../types"
import { TransactionExtraInfo } from "./transaction-extra-info"

function makeDetail(overrides: Record<string, unknown> = {}): TransactionDetail {
  return {
    transaction: { id: 1, notes: null, deleted_reason: null, ...overrides },
    items: [],
    payment_breakdown: [],
  } as unknown as TransactionDetail
}

function renderInfo(detail: TransactionDetail) {
  return render(
    <TransactionExtraInfo
      checkingPpobId={null}
      detail={detail}
      isAdmin={false}
      ppobItems={[]}
      onCheckPpob={vi.fn()}
      onResolvePpob={vi.fn()}
    />,
  )
}

describe("TransactionExtraInfo", () => {
  it("renders nothing without notes, void reason or PPOB lines", () => {
    const { container } = renderInfo(makeDetail())
    expect(container).toBeEmptyDOMElement()
  })

  it("shows the notes", () => {
    renderInfo(makeDetail({ notes: "Titip kembalian" }))
    expect(screen.getByText("Info Tambahan")).toBeInTheDocument()
    expect(screen.getByText("Titip kembalian")).toBeInTheDocument()
  })

  it("shows the void reason", () => {
    renderInfo(makeDetail({ deleted_reason: "Salah input" }))
    expect(screen.getByText("Alasan Penghapusan")).toBeInTheDocument()
    expect(screen.getByText("Salah input")).toBeInTheDocument()
  })
})

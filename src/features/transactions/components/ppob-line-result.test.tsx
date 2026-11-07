import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import type { TransactionItem } from "../types"
import { PpobLineResult } from "./ppob-line-result"

function makeLine(overrides: Record<string, unknown> = {}): TransactionItem {
  return {
    id: 7,
    product_name: "Pulsa 10K",
    service_type: "pulsa",
    ppob_status: "success",
    ppob_serial_number: null,
    ppob_message: null,
    ...overrides,
  } as unknown as TransactionItem
}

describe("PpobLineResult", () => {
  it("shows the product name and serial number", () => {
    render(
      <PpobLineResult
        checkingId={null}
        line={makeLine({ ppob_serial_number: "SN-123" })}
        onCheck={vi.fn()}
      />,
    )
    expect(screen.getByText("Pulsa 10K")).toBeInTheDocument()
    expect(screen.getByText("SN-123")).toBeInTheDocument()
  })

  it("shows the provider message for a failed line", () => {
    render(
      <PpobLineResult
        checkingId={null}
        line={makeLine({ ppob_status: "failed", ppob_message: "Nomor salah" })}
        onCheck={vi.fn()}
      />,
    )
    expect(screen.getByText("Transaksi ditolak provider")).toBeInTheDocument()
    expect(screen.getByText(/Nomor salah/)).toBeInTheDocument()
  })

  it("offers a status check for an uncertain line", () => {
    const onCheck = vi.fn()
    render(
      <PpobLineResult
        checkingId={null}
        line={makeLine({ ppob_status: "uncertain" })}
        onCheck={onCheck}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Cek status/ }))
    expect(onCheck).toHaveBeenCalledWith(7)
  })
})

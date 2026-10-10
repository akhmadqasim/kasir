import { describe, expect, it } from "vitest"

import { apiFailure, installApiMock } from "@/test-utils/api-mock"
import { ppobRetryFailureMessage, ppobRetrySuccessMessage, retryPpobLines } from "./ppob-retry"
import type { TransactionItem } from "./types"

function ppobLine(id: number, name: string): TransactionItem {
  return {
    id,
    transaction_id: 7,
    product_id: null,
    product_name: name,
    product_price: 10000,
    buy_price: 9500,
    quantity: 1,
    subtotal: 10000,
    item_discount: 0,
    net_subtotal: 10000,
    service_type: "pulsa",
    service_ref: "081234567890",
    ppob_product_id: null,
    ppob_product_code: "S10",
    ppob_inquiry_id: null,
    ppob_payment_code: null,
    ppob_flag_id: null,
    ppob_status: "failed",
    ppob_message: null,
    ppob_serial_number: null,
    created_at: "2026-09-05 03:00:00",
  } as TransactionItem
}

describe("retryPpobLines", () => {
  it("tries every line even after one is refused, and reports only the refused ones", async () => {
    const api = installApiMock({
      "POST /transaction-items/1/ppob/retry": "ok",
      "POST /transaction-items/2/ppob/retry": apiFailure(422, "validation", "Sudah diproses"),
      "POST /transaction-items/3/ppob/retry": "ok",
    })
    const lines = [
      ppobLine(1, "Pulsa 10.000"),
      ppobLine(2, "Token 20.000"),
      ppobLine(3, "Pulsa 5.000"),
    ]

    const failures = await retryPpobLines(lines, "123456")

    expect(api.calls.map((call) => call.path)).toEqual([
      "/transaction-items/1/ppob/retry",
      "/transaction-items/2/ppob/retry",
      "/transaction-items/3/ppob/retry",
    ])
    expect(api.calls.every((call) => (call.body as { pin: string }).pin === "123456")).toBe(true)
    expect(failures).toEqual([{ item: lines[1], message: "Sudah diproses" }])
  })

  it("reports nothing when every line goes through", async () => {
    installApiMock({ "POST /transaction-items/*/ppob/retry": "ok" })
    expect(await retryPpobLines([ppobLine(1, "Pulsa")], "1234")).toEqual([])
  })
})

describe("ppobRetryFailureMessage", () => {
  it("shows the plain server reason when the only line tried was refused", () => {
    const message = ppobRetryFailureMessage(
      [{ item: ppobLine(1, "Pulsa"), message: "PIN salah" }],
      1,
    )
    expect(message).toContain("PIN salah")
    expect(message).not.toContain("Pulsa:")
  })

  it("names each refused line when several were tried", () => {
    const message = ppobRetryFailureMessage(
      [
        { item: ppobLine(1, "Pulsa 10.000"), message: "Sudah diproses" },
        { item: ppobLine(2, "Token 20.000"), message: "Saldo kurang" },
      ],
      3,
    )
    expect(message).toBe(
      "2 dari 3 PPOB gagal dicoba ulang — Pulsa 10.000: Sudah diproses; Token 20.000: Saldo kurang",
    )
  })
})

describe("ppobRetrySuccessMessage", () => {
  it("counts the lines that went back to the provider", () => {
    expect(ppobRetrySuccessMessage(3)).toContain("3")
  })
})

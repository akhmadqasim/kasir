import { describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

vi.mock("@/features/shift/hooks/use-shift-store", () => {
  const state = { activeShift: { id: 1 }, fetchActiveShift: async () => null }
  return { useShiftStore: (select: (s: typeof state) => unknown) => select(state) }
})

import type { TransactionResult } from "@/features/cashier/types"
import { usePpobCheckout } from "./components/checkout/use-ppob-checkout"
import type { AddToCartItem } from "./components/quick-access/types"

const PULSA: AddToCartItem = {
  name: "Pulsa 10.000 - 081234567890",
  price: 11_000,
  service_type: "pulsa",
  service_ref: "081234567890",
  buy_price: 10_500,
  ppob_product_code: "TSEL10",
}

describe("usePpobCheckout idempotency key", () => {
  it("replays the same key when the cashier cancels and pays the same line again", () => {
    const { result } = renderHook(() => usePpobCheckout())

    act(() => result.current.begin(PULSA))
    const first = result.current.sale?.idempotencyKey
    act(() => result.current.cancel())
    act(() => result.current.begin({ ...PULSA }))

    expect(first).toBeTruthy()
    expect(result.current.sale?.idempotencyKey).toBe(first)
  })

  it("mints a new key for a different line or after the line was paid", () => {
    const { result } = renderHook(() => usePpobCheckout())

    act(() => result.current.begin(PULSA))
    const first = result.current.sale?.idempotencyKey
    act(() => result.current.cancel())
    act(() => result.current.begin({ ...PULSA, service_ref: "089999999999" }))
    const second = result.current.sale?.idempotencyKey
    expect(second).not.toBe(first)

    act(() => result.current.onPaid({} as TransactionResult))
    act(() => result.current.begin({ ...PULSA, service_ref: "089999999999" }))
    expect(result.current.sale?.idempotencyKey).not.toBe(second)
  })
})

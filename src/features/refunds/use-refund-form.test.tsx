import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { apiFailure, installApiMock, type ApiMock } from "@/test-utils/api-mock"
import type { Product } from "@/features/products/types"
import type { TransactionDetail, TransactionDetailItem } from "@/features/transactions/types"
import type { CreateRefundInput } from "./types"

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: toastMock }))

import { useRefundForm } from "./hooks/use-refund-form"

/** "YYYY-MM-DD HH:MM:SS" in UTC, `hoursAgo` before now — the backend's shape. */
function soldHoursAgo(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString().replace("T", " ").slice(0, 19)
}

function line(overrides: Partial<TransactionDetailItem> = {}): TransactionDetailItem {
  const row = {
    id: 11,
    transaction_id: 7,
    product_id: 3,
    product_name: "Minyak Goreng 1L",
    product_price: 15000,
    buy_price: 12000,
    quantity: 2,
    subtotal: 30000,
    item_discount: 0,
    net_subtotal: 30000,
    service_type: null,
    service_ref: null,
    ppob_product_id: null,
    ppob_product_code: null,
    ppob_inquiry_id: null,
    ppob_payment_code: null,
    ppob_flag_id: null,
    ppob_status: null,
    ppob_message: null,
    ppob_serial_number: null,
    created_at: "2026-09-05 03:00:00",
    refunded_quantity: 0,
    ppob_manual_fail_opens_at: null,
    ...overrides,
  }
  // The refund state the server reports for such a row.
  const refundable = row.product_id !== null || row.ppob_status === "failed"
  return {
    refundable,
    refundable_quantity: refundable ? Math.max(row.quantity - row.refunded_quantity, 0) : 0,
    ...row,
  }
}

function detail(
  items: TransactionDetailItem[],
  createdAt: string = soldHoursAgo(1),
  status = "completed",
): TransactionDetail {
  return {
    transaction: {
      id: 7,
      receipt_number: "TRX-20260905-0007",
      user_id: 1,
      total_amount: 30000,
      subtotal_amount: 30000,
      discount_amount: 0,
      payment_method: "cash",
      payment_amount: 30000,
      change_amount: 0,
      status,
      channel: "sales",
      notes: null,
      deleted_at: null,
      deleted_by: null,
      deleted_reason: null,
      updated_at: null,
      created_at: createdAt,
    },
    items,
    cashier_name: "Ahmad",
    has_refundable_goods: items.some((item) => item.refundable_quantity > 0),
    has_refundable_failed_ppob: items.some(
      (item) =>
        item.product_id === null && item.ppob_status === "failed" && item.refundable_quantity > 0,
    ),
    has_ppob: false,
    ppob_status: null,
    ppob_message: null,
    ppob_serial_number: null,
    payment_breakdown: [],
  }
}

function product(id: number, name: string, sellPrice: number): Product {
  return {
    id,
    barcode: null,
    sku: null,
    name,
    category_id: null,
    buy_price: 1000,
    sell_price: sellPrice,
    margin: 0,
    stock: 40,
    unit: "pcs",
    min_stock: 0,
    is_active: true,
    created_at: "2026-09-05 00:00:00",
    updated_at: "2026-09-05 00:00:00",
  }
}

let api: ApiMock

function renderForm(sale: TransactionDetail, onSuccess = vi.fn()) {
  api = installApiMock({
    "GET /transactions/*": sale,
    "POST /refunds": { id: 1, refund_number: "RFD-20260905-0001" },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useRefundForm({ transactionId: 7, userId: 1, onSuccess }), {
    wrapper,
  })
  return { ...hook, client, onSuccess }
}

async function loaded(result: { current: ReturnType<typeof useRefundForm> }) {
  await waitFor(() => expect(result.current.detail).toBeDefined())
  await waitFor(() => expect(Object.keys(result.current.itemStates).length).toBeGreaterThan(0))
}

beforeEach(() => {
  toastMock.success.mockReset()
  toastMock.error.mockReset()
})

describe("useRefundForm — refund amount", () => {
  it("pays back what the customer paid per unit, not the list price, when the line was discounted", async () => {
    // 2 × Rp15.000 list, Rp27.000 paid after discounts → Rp13.500 per unit.
    const { result } = renderForm(detail([line({ net_subtotal: 27000, item_discount: 3000 })]))
    await loaded(result)

    act(() => result.current.updateItem(11, { checked: true, quantity: 1 }))
    expect(result.current.totalRefund).toBe(13500)

    act(() => result.current.updateItem(11, { quantity: 2 }))
    expect(result.current.totalRefund).toBe(27000)
  })

  it("sums every ticked line and ignores unticked ones", async () => {
    const { result } = renderForm(
      detail([
        line({ id: 11 }),
        line({
          id: 12,
          product_id: 4,
          product_name: "Gula 1kg",
          quantity: 3,
          subtotal: 45000,
          net_subtotal: 45000,
        }),
      ]),
    )
    await loaded(result)

    act(() => result.current.updateItem(12, { checked: true, quantity: 2 }))
    expect(result.current.totalRefund).toBe(30000)
    expect(result.current.selectedItems.map((item) => item.id)).toEqual([12])
  })

  it("leaves PPOB lines out of what can be refunded", async () => {
    const { result } = renderForm(
      detail([line(), line({ id: 20, product_id: null, product_name: "Pulsa 10.000" })]),
    )
    await loaded(result)

    expect(result.current.refundableItems.map((item) => item.id)).toEqual([11])
    expect(result.current.nonRefundableItems.map((item) => item.id)).toEqual([20])
    expect(result.current.itemStates[20]).toBeUndefined()
  })

  it("starts each line at what is left after earlier refunds", async () => {
    const { result } = renderForm(
      detail([line({ quantity: 5, refunded_quantity: 2 })], soldHoursAgo(1), "partial_refund"),
    )
    await loaded(result)

    expect(result.current.itemStates[11]).toMatchObject({ checked: false, quantity: 3, maxQty: 3 })
    expect(result.current.hasEarlierRefund).toBe(true)
  })
})

describe("useRefundForm — exchange difference", () => {
  it("is positive when the returned goods are worth more (the shop pays back)", async () => {
    const { result } = renderForm(detail([line()]))
    await loaded(result)

    act(() => {
      result.current.setActionType("exchange")
      result.current.updateItem(11, { checked: true, quantity: 2 })
      result.current.addExchangeItem(product(4, "Gula 1kg", 18000))
    })

    expect(result.current.totalRefund).toBe(30000)
    expect(result.current.totalExchange).toBe(18000)
    expect(result.current.difference).toBe(12000)
  })

  it("is negative when the replacement costs more (the customer pays)", async () => {
    const { result } = renderForm(detail([line()]))
    await loaded(result)

    act(() => {
      result.current.setActionType("exchange")
      result.current.updateItem(11, { checked: true, quantity: 1 })
      result.current.addExchangeItem(product(4, "Beras 5kg", 70000))
    })

    expect(result.current.difference).toBe(15000 - 70000)
  })

  it("adds a second pick of the same replacement to its quantity instead of a new row", async () => {
    const { result } = renderForm(detail([line()]))
    await loaded(result)

    act(() => {
      result.current.setActionType("exchange")
      result.current.addExchangeItem(product(4, "Gula 1kg", 18000))
      result.current.addExchangeItem(product(4, "Gula 1kg", 18000))
    })

    expect(result.current.exchangeItems).toHaveLength(1)
    expect(result.current.exchangeItems[0].quantity).toBe(2)
    expect(result.current.totalExchange).toBe(36000)
  })

  it("never lets a replacement quantity drop below one", async () => {
    const { result } = renderForm(detail([line()]))
    await loaded(result)

    act(() => {
      result.current.setActionType("exchange")
      result.current.addExchangeItem(product(4, "Gula 1kg", 18000))
    })
    act(() => result.current.updateExchangeQty(4, 0))
    expect(result.current.exchangeItems[0].quantity).toBe(1)
    act(() => result.current.updateExchangeQty(4, -3))
    expect(result.current.exchangeItems[0].quantity).toBe(1)
  })

  // Like-for-like ("tukar barang sama"): the server prices a replacement of a
  // product that is coming back at what was paid for it (`ReturnedCredit` in
  // exchange.rs). The screen used to charge today's sell_price, asking the
  // customer for money the books never record.
  it("prices a swap of a discounted line for the same product at what was paid", async () => {
    // 2 × Rp15.000 list, Rp27.000 paid → Rp13.500 per unit.
    const { result } = renderForm(detail([line({ net_subtotal: 27000, item_discount: 3000 })]))
    await loaded(result)

    act(() => {
      result.current.setActionType("exchange")
      result.current.updateItem(11, { checked: true, quantity: 1 })
      result.current.addExchangeItem(product(3, "Minyak Goreng 1L", 15000))
    })

    expect(result.current.totalRefund).toBe(13500)
    expect(result.current.totalExchange).toBe(13500)
    expect(result.current.difference).toBe(0)
    expect(result.current.pricedExchangeItems[0]).toMatchObject({
      matchedQuantity: 1,
      unitPrice: 13500,
      subtotal: 13500,
    })
  })

  it("prices a like-for-like swap at the sale's price after the price was raised", async () => {
    const { result } = renderForm(detail([line()]))
    await loaded(result)

    act(() => {
      result.current.setActionType("exchange")
      result.current.updateItem(11, { checked: true, quantity: 2 })
      // Rp15.000 at the sale, Rp17.000 today.
      result.current.addExchangeItem(product(3, "Minyak Goreng 1L", 17000))
      result.current.addExchangeItem(product(3, "Minyak Goreng 1L", 17000))
    })

    expect(result.current.totalExchange).toBe(30000)
    expect(result.current.difference).toBe(0)
  })

  it("charges today's price only for replacement units beyond what came back", async () => {
    const { result } = renderForm(detail([line({ net_subtotal: 27000, item_discount: 3000 })]))
    await loaded(result)

    act(() => {
      result.current.setActionType("exchange")
      result.current.updateItem(11, { checked: true, quantity: 1 })
      result.current.addExchangeItem(product(3, "Minyak Goreng 1L", 17000))
    })
    act(() => result.current.updateExchangeQty(3, 3))

    // One unit at the Rp13.500 paid, two more at Rp17.000.
    expect(result.current.totalExchange).toBe(13500 + 2 * 17000)
    expect(result.current.difference).toBe(13500 - 47500)
    expect(result.current.pricedExchangeItems[0]).toMatchObject({
      matchedQuantity: 1,
      subtotal: 47500,
      unitPrice: 47500 / 3,
    })
  })

  it("drops the replacement goods when switching back to a plain refund", async () => {
    const { result } = renderForm(detail([line()]))
    await loaded(result)

    act(() => {
      result.current.setActionType("exchange")
      result.current.addExchangeItem(product(4, "Gula 1kg", 18000))
    })
    act(() => result.current.setActionType("refund"))

    expect(result.current.exchangeItems).toEqual([])
    expect(result.current.totalExchange).toBe(0)
  })
})

describe("useRefundForm — submit", () => {
  it("sends the ticked lines with quantity and condition, and no exchange goods for a refund", async () => {
    const { result, onSuccess } = renderForm(detail([line(), line({ id: 12, product_id: 4 })]))
    await loaded(result)

    act(() => {
      result.current.updateItem(11, { checked: true, quantity: 1, condition: "damaged" })
      result.current.setReason("Kemasan bocor")
    })
    await act(() => result.current.handleSubmit())

    const body = api.lastCall("POST /refunds")?.body as CreateRefundInput
    expect(body).toEqual({
      transaction_id: 7,
      reason: "Kemasan bocor",
      items: [{ transaction_item_id: 11, quantity: 1, condition: "damaged" }],
      exchange_items: undefined,
    })
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(toastMock.success).toHaveBeenCalled()
  })

  it("sends the replacement goods for an exchange", async () => {
    const { result } = renderForm(detail([line()]))
    await loaded(result)

    act(() => {
      result.current.setActionType("exchange")
      result.current.updateItem(11, { checked: true, quantity: 1 })
      result.current.addExchangeItem(product(4, "Gula 1kg", 18000))
    })
    await act(() => result.current.handleSubmit())

    const body = api.lastCall("POST /refunds")?.body as CreateRefundInput
    expect(body.exchange_items).toEqual([{ product_id: 4, quantity: 1 }])
  })

  it("refuses to submit with nothing ticked", async () => {
    const { result } = renderForm(detail([line()]))
    await loaded(result)

    await act(() => result.current.handleSubmit())

    expect(api.callsFor("POST /refunds")).toHaveLength(0)
    expect(toastMock.error).toHaveBeenCalledWith("Pilih minimal 1 item untuk refund")
  })

  it("refuses an exchange without replacement goods", async () => {
    const { result } = renderForm(detail([line()]))
    await loaded(result)

    act(() => {
      result.current.setActionType("exchange")
      result.current.updateItem(11, { checked: true, quantity: 1 })
    })
    await act(() => result.current.handleSubmit())

    expect(api.callsFor("POST /refunds")).toHaveLength(0)
    expect(toastMock.error).toHaveBeenCalledWith("Tambah minimal 1 barang pengganti")
  })

  it("blocks a sale older than seven days without asking the server", async () => {
    const { result } = renderForm(detail([line()], soldHoursAgo(7 * 24 + 1)))
    await loaded(result)

    expect(result.current.blockedReason).toMatch(/7 hari/)
    act(() => result.current.updateItem(11, { checked: true, quantity: 1 }))
    await act(() => result.current.handleSubmit())

    expect(api.callsFor("POST /refunds")).toHaveLength(0)
    expect(toastMock.error).toHaveBeenCalledWith(result.current.blockedReason)
  })

  // A top-up can sit uncertain for days and be marked failed on day 8: the
  // customer paid and got no token, so that money still goes back. Only that
  // line — the goods of the same sale stay past their window.
  it("refunds a failed PPOB line past seven days, and only that line", async () => {
    const pulsa = line({
      id: 12,
      product_id: null,
      product_name: "Pulsa 10K",
      service_type: "pulsa",
      ppob_status: "failed",
      product_price: 12000,
      subtotal: 12000,
      net_subtotal: 12000,
    })
    const { result } = renderForm(detail([line(), pulsa], soldHoursAgo(8 * 24)))
    await loaded(result)

    expect(result.current.blockedReason).toBeNull()
    expect(result.current.refundableItems.map((item) => item.id)).toEqual([12])
    expect(result.current.nonRefundableItems.map((item) => item.id)).toEqual([11])

    act(() => result.current.updateItem(12, { checked: true, quantity: 1 }))
    await act(() => result.current.handleSubmit())

    expect(api.lastCall("POST /refunds")?.body).toMatchObject({
      items: [{ transaction_item_id: 12, quantity: 1 }],
    })
  })

  // The failed top-up lifts the window for a refund only. An exchange sends
  // new goods out, so past seven days it stays blocked, like the server's
  // `check_refund_window`.
  it("keeps the exchange blocked past seven days even with a failed PPOB line", async () => {
    const pulsa = line({
      id: 12,
      product_id: null,
      product_name: "Pulsa 10K",
      service_type: "pulsa",
      ppob_status: "failed",
      product_price: 12000,
      subtotal: 12000,
      net_subtotal: 12000,
    })
    const { result } = renderForm(detail([line(), pulsa], soldHoursAgo(8 * 24)))
    await loaded(result)

    expect(result.current.exchangeBlockedReason).toMatch(/7 hari/)
    act(() => {
      result.current.setActionType("exchange")
      result.current.updateItem(12, { checked: true, quantity: 1 })
      result.current.addExchangeItem(product(5, "Kopi Sachet", 1500))
    })
    expect(result.current.blockedReason).toMatch(/tukar barang/)
    await act(() => result.current.handleSubmit())

    expect(api.callsFor("POST /refunds")).toHaveLength(0)
    expect(toastMock.error).toHaveBeenCalledWith(result.current.blockedReason)

    act(() => result.current.setActionType("refund"))
    expect(result.current.blockedReason).toBeNull()
  })

  it("still allows a sale just inside the seven-day window", async () => {
    const { result } = renderForm(detail([line()], soldHoursAgo(7 * 24 - 1)))
    await loaded(result)

    expect(result.current.blockedReason).toBeNull()
  })

  it("lowers the line's cap to what the server says is left after a rejected submit", async () => {
    const { result } = renderForm(detail([line({ quantity: 5 })]))
    await loaded(result)
    api.route(
      "POST /refunds",
      apiFailure(
        422,
        "validation",
        "Jumlah refund melebihi sisa yang bisa di-refund (2) untuk Minyak Goreng 1L",
      ),
    )

    act(() => result.current.updateItem(11, { checked: true, quantity: 4 }))
    await act(() => result.current.handleSubmit())

    expect(result.current.itemStates[11]).toMatchObject({ checked: true, maxQty: 2, quantity: 2 })
    expect(toastMock.error).toHaveBeenCalledWith(
      "Sisa Minyak Goreng 1L yang bisa diretur tinggal 2. Jumlahnya sudah disesuaikan.",
    )
    expect(result.current.isSubmitting).toBe(false)
  })

  it("unticks the line when the server says nothing is left of it", async () => {
    const { result } = renderForm(detail([line({ quantity: 5 })]))
    await loaded(result)
    api.route(
      "POST /refunds",
      apiFailure(422, "validation", "melebihi sisa yang bisa di-refund (0) untuk Minyak Goreng 1L"),
    )

    act(() => result.current.updateItem(11, { checked: true, quantity: 4 }))
    await act(() => result.current.handleSubmit())

    expect(result.current.itemStates[11]).toMatchObject({ checked: false, maxQty: 0 })
  })

  it("shows any other server error and keeps the form as it was", async () => {
    const { result, onSuccess } = renderForm(detail([line()]))
    await loaded(result)
    api.route("POST /refunds", apiFailure(500, "internal", "Database terkunci"))

    act(() => result.current.updateItem(11, { checked: true, quantity: 1 }))
    await act(() => result.current.handleSubmit())

    expect(toastMock.error).toHaveBeenCalledWith("Gagal memproses refund: Database terkunci")
    expect(result.current.itemStates[11]).toMatchObject({ checked: true, quantity: 1 })
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

describe("useRefundForm — background refetch", () => {
  it("keeps the cashier's ticks and quantities when the same sale is fetched again", async () => {
    const { result, client } = renderForm(detail([line({ quantity: 5 })]))
    await loaded(result)

    act(() => result.current.updateItem(11, { checked: true, quantity: 3, condition: "expired" }))
    await act(() => client.invalidateQueries())
    await waitFor(() => expect(api.callsFor("GET /transactions/*").length).toBeGreaterThan(1))

    expect(result.current.itemStates[11]).toMatchObject({
      checked: true,
      quantity: 3,
      condition: "expired",
    })
  })

  it("lowers the cap when the refetch reports units returned at another till", async () => {
    const { result, client } = renderForm(detail([line({ quantity: 5 })]))
    await loaded(result)

    act(() => result.current.updateItem(11, { checked: true, quantity: 4 }))
    api.route("GET /transactions/*", detail([line({ quantity: 5, refunded_quantity: 3 })]))
    await act(() => client.invalidateQueries())

    await waitFor(() => expect(result.current.itemStates[11].maxQty).toBe(2))
    expect(result.current.itemStates[11]).toMatchObject({ checked: true, quantity: 2 })
  })
})

describe("useRefundForm — invalid address", () => {
  it("reports a malformed transaction id without querying the server", () => {
    api = installApiMock({})
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useRefundForm({ transactionId: Number.NaN, userId: 1 }), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })

    expect(result.current.loadError).toBe("Nomor transaksi tidak valid.")
    expect(result.current.canRetryLoad).toBe(false)
    expect(result.current.isLoading).toBe(false)
    expect(api.calls).toHaveLength(0)
  })
})

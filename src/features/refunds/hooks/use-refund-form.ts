import { useState, useMemo, useCallback, useEffect } from "react"
import { toast } from "@/lib/toast"
import { useQueryClient } from "@tanstack/react-query"
import { useApiQuery } from "@/hooks/use-api"
import { errorMessage } from "@/lib/api/client"
import { createRefund } from "@/lib/api/refunds"
import { getTransactionDetail } from "@/lib/api/transactions"
import { queryKeys } from "@/lib/api/query-keys"
import { id } from "@/i18n/id"
import { netAmountForQuantity } from "@/lib/line-amounts"
import { isLineInsideRefundWindow, refundActionBlockedReason } from "@/lib/refund-window"
import type { TransactionDetail, TransactionDetailItem } from "@/features/transactions/types"
import {
  hasRefundedLines,
  isRefundableLine,
  parseRemainingQuantityError,
  remainingQuantityMessage,
  remainingRefundableQuantity,
  type RemainingQuantityLimit,
} from "../refund-limits"
import type { Product } from "@/features/products/types"
import { priceExchangeItems, type ExchangeLinePrice } from "../exchange-pricing"
import type { CreateRefundInput, RefundCondition } from "../types"

export type ActionType = "refund" | "exchange"

export interface RefundItemState {
  checked: boolean
  quantity: number
  condition: RefundCondition
  /**
   * Highest quantity the input offers: what is left of the line after earlier
   * refunds (`quantity - refunded_quantity`). A rejected submit can lower it
   * further when another till refunded the same sale in the meantime — see
   * `refund-limits.ts`.
   */
  maxQty: number
}

export interface ExchangeItem {
  product_id: number
  product_name: string
  sell_price: number
  quantity: number
  unit: string
}

/** A replacement with what it costs the customer, as the server will book it. */
export type PricedExchangeItem = ExchangeItem & ExchangeLinePrice

interface UseRefundFormOptions {
  transactionId: number | null
  /** Only used to keep the form disabled until the session has resolved. */
  userId: number | null
  onSuccess?: () => void
}

export function useRefundForm({ transactionId, userId, onSuccess }: UseRefundFormOptions) {
  const queryClient = useQueryClient()

  const [reason, setReason] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [itemStates, setItemStates] = useState<Record<number, RefundItemState>>({})
  const [actionType, setActionTypeRaw] = useState<ActionType>("refund")
  const [exchangeItems, setExchangeItems] = useState<ExchangeItem[]>([])

  // `/refund/abc` parses to NaN; treat it as "no such sale" instead of leaving
  // a disabled query that never resolves.
  const hasValidId = transactionId !== null && Number.isInteger(transactionId) && transactionId > 0

  const {
    data: detail,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useApiQuery<TransactionDetail>(
    queryKeys.transactions.detail(Number(transactionId)),
    () => getTransactionDetail(Number(transactionId)),
    { enabled: hasValidId },
  )

  /**
   * Lines a refund can actually touch: goods, and PPOB lines whose top-up failed.
   *
   * `resolve_refund_line` rejects any other line without a `product_id` — a
   * delivered (or still unsettled) top-up cannot come back — so listing them only
   * let the cashier tick one and collect the server's refusal after filling in the
   * whole form. A failed top-up was never delivered: its money goes back, whole.
   */
  // Past the seven days only a failed top-up still owed can come back — it has
  // no window (see `refund-window.ts`). When one is, the goods move to the
  // set-aside list; when none is, the whole page is blocked (`blockedReason`)
  // and the lines stay where they were.
  const hasFailedPpobOwed = detail?.has_refundable_failed_ppob ?? false
  const canReturnLine = useCallback(
    (item: TransactionDetailItem) =>
      isRefundableLine(item) &&
      (!hasFailedPpobOwed || isLineInsideRefundWindow(item, detail?.transaction.created_at)),
    [detail, hasFailedPpobOwed],
  )

  const refundableItems = useMemo(
    () => (detail?.items ?? []).filter(canReturnLine),
    [detail, canReturnLine],
  )

  const nonRefundableItems = useMemo(
    () => (detail?.items ?? []).filter((item) => !canReturnLine(item)),
    [detail, canReturnLine],
  )

  // Seed a state per line, but keep what the cashier already set: a background
  // refetch of the same sale (another screen invalidating `transactions`) used
  // to wipe every tick, quantity and condition — and the lowered caps from a
  // rejected submit — halfway through filling in the form. A refetch that
  // reports more units returned still lowers the cap; nothing raises it.
  useEffect(() => {
    if (!detail) return
    setItemStates((prev) => {
      const states: Record<number, RefundItemState> = {}
      for (const item of refundableItems) {
        const remaining = remainingRefundableQuantity(item)
        const current = prev[item.id]
        if (!current) {
          states[item.id] = {
            checked: false,
            quantity: Math.max(remaining, 1),
            condition: "good",
            maxQty: remaining,
          }
          continue
        }
        const maxQty = Math.min(current.maxQty, remaining)
        states[item.id] = {
          ...current,
          checked: maxQty > 0 && current.checked,
          maxQty,
          quantity: Math.max(Math.min(current.quantity, maxQty), 1),
        }
      }
      return states
    })
  }, [detail, refundableItems])

  const updateItem = useCallback((itemId: number, updates: Partial<RefundItemState>) => {
    setItemStates((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...updates },
    }))
  }, [])

  /**
   * Lower the cap on every line for that product to what the server says is left.
   *
   * Matching by name is as precise as the error message allows; a transaction with
   * two separate lines of the same product would clamp both. That only ever offers
   * *less*, never more, so the worst case is a second submit — not an over-refund.
   */
  const applyRemainingQuantityLimit = useCallback(
    (limit: RemainingQuantityLimit) => {
      const affected = refundableItems.filter((item) => item.product_name === limit.productName)
      if (affected.length === 0) return

      setItemStates((prev) => {
        const next = { ...prev }
        for (const item of affected) {
          const state = next[item.id]
          if (!state) continue
          next[item.id] = {
            ...state,
            checked: limit.remaining > 0 && state.checked,
            maxQty: limit.remaining,
            quantity: Math.max(Math.min(state.quantity, limit.remaining), 1),
          }
        }
        return next
      })
    },
    [refundableItems],
  )

  const setActionType = useCallback((type: ActionType) => {
    setActionTypeRaw(type)
    if (type === "refund") {
      setExchangeItems([])
    }
  }, [])

  const addExchangeItem = useCallback((product: Product) => {
    setExchangeItems((prev) => {
      const existing = prev.find((i) => i.product_id === product.id)
      if (existing) {
        return prev.map((i) =>
          i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i,
        )
      }
      return [
        ...prev,
        {
          product_id: product.id,
          product_name: product.name,
          sell_price: product.sell_price,
          quantity: 1,
          unit: product.unit,
        },
      ]
    })
  }, [])

  const updateExchangeQty = useCallback((productId: number, qty: number) => {
    setExchangeItems((prev) =>
      prev.map((i) => (i.product_id === productId ? { ...i, quantity: Math.max(1, qty) } : i)),
    )
  }, [])

  const removeExchangeItem = useCallback((productId: number) => {
    setExchangeItems((prev) => prev.filter((i) => i.product_id !== productId))
  }, [])

  const selectedItems = useMemo(
    () => refundableItems.filter((item) => itemStates[item.id]?.checked),
    [refundableItems, itemStates],
  )

  // Money handed back is what the customer paid, not the list price. Mirrors
  // `refund_amount_for` in `services/refunds/mod.rs`; using `product_price` here gave
  // every discount back on top of the refund, at the shop's expense.
  const totalRefund = useMemo(() => {
    return selectedItems.reduce((sum, item) => {
      const state = itemStates[item.id]
      return sum + netAmountForQuantity(item, state?.quantity ?? 0)
    }, 0)
  }, [selectedItems, itemStates])

  // A replacement of a product that is coming back is priced at what was paid
  // for it, not at today's price — see `exchange-pricing.ts`.
  const pricedExchangeItems = useMemo<PricedExchangeItem[]>(() => {
    const returned = selectedItems.map((item) => ({
      ...item,
      returnedQuantity: itemStates[item.id]?.quantity ?? 0,
    }))
    const prices = priceExchangeItems(returned, exchangeItems)
    return exchangeItems.map((item, index) => ({ ...item, ...prices[index] }))
  }, [selectedItems, itemStates, exchangeItems])

  const totalExchange = useMemo(() => {
    return pricedExchangeItems.reduce((sum, item) => sum + item.subtotal, 0)
  }, [pricedExchangeItems])

  const difference = totalRefund - totalExchange

  /**
   * Some of this sale has already come back. Each line's maximum already has the
   * returned units taken off; this only tells the cashier why it is lower than
   * what the receipt says was bought.
   */
  const hasEarlierRefund =
    detail?.transaction.status === "partial_refund" || hasRefundedLines(refundableItems)

  /**
   * Why an exchange of this sale is closed, or `null` when it is open. A
   * failed top-up still owed lifts the window for a refund only: an exchange
   * sends new goods out, so it keeps the seven days (`check_refund_window`).
   */
  const exchangeBlockedReason = detail
    ? refundActionBlockedReason(detail.transaction.created_at, {
        hasRefundableFailedPpob: hasFailedPpobOwed,
        action: "exchange",
      })
    : null

  /** Why the chosen action cannot go ahead for this sale, or `null` when it can. */
  const blockedReason = !detail
    ? null
    : actionType === "exchange"
      ? exchangeBlockedReason
      : refundActionBlockedReason(detail.transaction.created_at, {
          hasRefundableFailedPpob: hasFailedPpobOwed,
          action: "refund",
        })

  const handleSubmit = async () => {
    if (!transactionId || !userId || isSubmitting) return

    if (blockedReason) {
      toast.error(blockedReason)
      return
    }

    if (selectedItems.length === 0) {
      toast.error(id.refund.noItemsSelected)
      return
    }

    if (actionType === "exchange" && exchangeItems.length === 0) {
      toast.error(id.refund.noExchangeItems)
      return
    }

    setIsSubmitting(true)
    try {
      const refundInput: CreateRefundInput = {
        transaction_id: Number(transactionId),
        reason: reason || undefined,
        items: selectedItems.map((item) => ({
          transaction_item_id: item.id,
          quantity: itemStates[item.id].quantity,
          condition: itemStates[item.id].condition,
        })),
        exchange_items:
          actionType === "exchange"
            ? exchangeItems.map((i) => ({ product_id: i.product_id, quantity: i.quantity }))
            : undefined,
      }

      await createRefund(refundInput)
      // A return moves the sale's status, the refund list, stock, and — because
      // report figures are net of refunds — every report and dashboard panel.
      // Damaged/expired returns also land as write-offs.
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.refunds.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.stock.all })
      toast.success(actionType === "exchange" ? id.refund.exchangeSuccess : id.refund.refundSuccess)
      onSuccess?.()
    } catch (e) {
      const message = errorMessage(e)
      const limit = parseRemainingQuantityError(message)
      if (limit) {
        applyRemainingQuantityLimit(limit)
        toast.error(remainingQuantityMessage(limit))
        return
      }
      toast.error(`${id.refund.refundFailed}: ${message}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    // Data
    detail,
    refundableItems,
    nonRefundableItems,
    isLoading: hasValidId && isLoading,
    isFetching,
    /** Why the sale could not be loaded, or `null`. */
    loadError: hasValidId ? (error?.message ?? null) : id.refund.invalidTransactionId,
    /** A malformed id cannot be fixed by loading again, so there is no retry for it. */
    canRetryLoad: hasValidId,
    refetch,
    // State
    itemStates,
    actionType,
    exchangeItems,
    pricedExchangeItems,
    reason,
    isSubmitting,
    // Computed
    selectedItems,
    totalRefund,
    totalExchange,
    difference,
    hasEarlierRefund,
    blockedReason,
    exchangeBlockedReason,
    // Actions
    setReason,
    setActionType,
    updateItem,
    addExchangeItem,
    updateExchangeQty,
    removeExchangeItem,
    handleSubmit,
  }
}

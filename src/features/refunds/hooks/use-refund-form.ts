import { useState, useMemo, useCallback, useEffect } from "react"
import { toast } from "@/lib/toast"
import { useQueryClient } from "@tanstack/react-query"
import { useApiQuery } from "@/hooks/use-api"
import { createRefund } from "@/lib/api/refunds"
import { getTransactionDetail } from "@/lib/api/transactions"
import { queryKeys } from "@/lib/api/query-keys"
import { id } from "@/i18n/id"
import { netAmountForQuantity } from "@/features/transactions/line-amounts"
import { refundBlockedReason } from "@/features/transactions/refund-window"
import type { TransactionDetail } from "@/features/transactions/types"
import {
  parseRemainingQuantityError,
  remainingQuantityMessage,
  type RemainingQuantityLimit,
} from "../refund-limits"
import type { Product } from "@/features/products/types"
import type { CreateRefundInput } from "../types"

export type Condition = "good" | "damaged" | "expired"
export type ActionType = "refund" | "exchange"

export interface RefundItemState {
  checked: boolean
  quantity: number
  condition: Condition
  /**
   * Highest quantity the input offers. It starts at the purchased quantity
   * because no command exposes how much of the line has already been returned —
   * see `refund-limits.ts`. A rejected submit lowers it to the real remainder.
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

export const CONDITION_LABELS: Record<Condition, string> = {
  good: id.refund.conditionGood,
  damaged: id.refund.conditionDamaged,
  expired: id.refund.conditionExpired,
}

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

  const { data: detail, isLoading } = useApiQuery<TransactionDetail>(
    queryKeys.transactions.detail(Number(transactionId)),
    () => getTransactionDetail(Number(transactionId)),
    { enabled: !!transactionId }
  )

  /**
   * Lines a refund can actually touch.
   *
   * `resolve_refund_line` rejects any line without a `product_id` — a PPOB top-up
   * has no physical stock to give back — so listing them only let the cashier tick
   * one and collect "'…' bukan produk fisik dan tidak bisa di-refund" from the
   * server after filling in the whole form.
   */
  const refundableItems = useMemo(
    () => (detail?.items ?? []).filter((item) => item.product_id !== null),
    [detail]
  )

  const nonRefundableItems = useMemo(
    () => (detail?.items ?? []).filter((item) => item.product_id === null),
    [detail]
  )

  useEffect(() => {
    if (!detail) return
    const states: Record<number, RefundItemState> = {}
    for (const item of refundableItems) {
      states[item.id] = {
        checked: false,
        quantity: item.quantity,
        condition: "good",
        maxQty: item.quantity,
      }
    }
    setItemStates(states)
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
      const affected = refundableItems.filter(
        (item) => item.product_name === limit.productName
      )
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
    [refundableItems]
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
          i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i
        )
      }
      return [...prev, {
        product_id: product.id,
        product_name: product.name,
        sell_price: product.sell_price,
        quantity: 1,
        unit: product.unit,
      }]
    })
  }, [])

  const updateExchangeQty = useCallback((productId: number, qty: number) => {
    setExchangeItems((prev) =>
      prev.map((i) => i.product_id === productId ? { ...i, quantity: Math.max(1, qty) } : i)
    )
  }, [])

  const removeExchangeItem = useCallback((productId: number) => {
    setExchangeItems((prev) => prev.filter((i) => i.product_id !== productId))
  }, [])

  const selectedItems = useMemo(
    () => refundableItems.filter((item) => itemStates[item.id]?.checked),
    [refundableItems, itemStates]
  )

  // Money handed back is what the customer paid, not the list price. Mirrors
  // `refund_amount_for` in `commands/refunds.rs`; using `product_price` here gave
  // every discount back on top of the refund, at the shop's expense.
  const totalRefund = useMemo(() => {
    return selectedItems.reduce((sum, item) => {
      const state = itemStates[item.id]
      return sum + netAmountForQuantity(item, state?.quantity ?? 0)
    }, 0)
  }, [selectedItems, itemStates])

  const totalExchange = useMemo(() => {
    return exchangeItems.reduce((sum, item) => sum + item.sell_price * item.quantity, 0)
  }, [exchangeItems])

  const difference = totalRefund - totalExchange

  /**
   * Some of this sale has already come back. The per-line remainder is not part
   * of any command's response, so the form can only warn that the maximum it
   * offers is the purchased quantity, not the remaining one.
   */
  const hasEarlierRefund = detail?.transaction.status === "partial_refund"

  /** Why this sale cannot be refunded at all, or `null` when it can. */
  const blockedReason = detail
    ? refundBlockedReason(detail.transaction.created_at)
    : null

  const handleSubmit = async () => {
    if (!transactionId || !userId) return

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
        exchange_items: actionType === "exchange"
          ? exchangeItems.map((i) => ({ product_id: i.product_id, quantity: i.quantity }))
          : undefined,
      }

      await createRefund(refundInput)
      // A return moves the sale's status, the refund list, stock, and — because
      // report figures are net of refunds — every report and dashboard panel.
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.refunds.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all })
      toast.success(actionType === "exchange" ? id.refund.exchangeSuccess : id.refund.refundSuccess)
      onSuccess?.()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
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
    isLoading,
    // State
    itemStates,
    actionType,
    exchangeItems,
    reason,
    isSubmitting,
    // Computed
    selectedItems,
    totalRefund,
    totalExchange,
    difference,
    hasEarlierRefund,
    blockedReason,
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

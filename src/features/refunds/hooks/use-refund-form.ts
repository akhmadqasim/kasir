import { useState, useMemo, useCallback, useEffect } from "react"
import { toast } from "@/lib/toast"
import { invoke } from "@tauri-apps/api/core"
import { useQueryClient } from "@tanstack/react-query"
import { useTauriQuery } from "@/hooks/use-tauri-command"
import { id } from "@/i18n/id"
import type { TransactionDetail } from "@/features/transactions/types"
import type { Product } from "@/features/products/types"
import type { CreateRefundInput, RefundResult } from "../types"

export type Condition = "good" | "damaged" | "expired"
export type ActionType = "refund" | "exchange"

export interface RefundItemState {
  checked: boolean
  quantity: number
  condition: Condition
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

  const { data: detail, isLoading } = useTauriQuery<TransactionDetail>(
    "get_transaction_detail",
    { transactionId: Number(transactionId) },
    { enabled: !!transactionId }
  )

  useEffect(() => {
    if (!detail) return
    const states: Record<number, RefundItemState> = {}
    for (const item of detail.items) {
      states[item.id] = {
        checked: false,
        quantity: item.quantity,
        condition: "good",
        maxQty: item.quantity,
      }
    }
    setItemStates(states)
  }, [detail])

  const updateItem = useCallback((itemId: number, updates: Partial<RefundItemState>) => {
    setItemStates((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...updates },
    }))
  }, [])

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

  const selectedItems = useMemo(() => {
    if (!detail) return []
    return detail.items.filter((item) => itemStates[item.id]?.checked)
  }, [detail, itemStates])

  const totalRefund = useMemo(() => {
    return selectedItems.reduce((sum, item) => {
      const state = itemStates[item.id]
      return sum + item.product_price * (state?.quantity ?? 0)
    }, 0)
  }, [selectedItems, itemStates])

  const totalExchange = useMemo(() => {
    return exchangeItems.reduce((sum, item) => sum + item.sell_price * item.quantity, 0)
  }, [exchangeItems])

  const difference = totalRefund - totalExchange

  const handleSubmit = async () => {
    if (!transactionId || !userId) return

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
        user_id: userId,
        reason: reason || undefined,
        items: selectedItems.map((item) => ({
          transaction_item_id: item.id,
          product_id: item.product_id!,
          quantity: itemStates[item.id].quantity,
          condition: itemStates[item.id].condition,
        })),
        exchange_items: actionType === "exchange"
          ? exchangeItems.map((i) => ({ product_id: i.product_id, quantity: i.quantity }))
          : undefined,
      }

      await invoke<RefundResult>("create_refund", { input: refundInput })
      queryClient.invalidateQueries({ queryKey: ["list_transactions"] })
      queryClient.invalidateQueries({ queryKey: ["list_refunds"] })
      queryClient.invalidateQueries({ queryKey: ["search_products"] })
      toast.success(actionType === "exchange" ? id.refund.exchangeSuccess : id.refund.refundSuccess)
      onSuccess?.()
    } catch (e) {
      toast.error(`${id.refund.refundFailed}: ${e}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    // Data
    detail,
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

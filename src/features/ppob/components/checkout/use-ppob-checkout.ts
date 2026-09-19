import { useCallback, useEffect, useState } from "react"

import type { DirectSale } from "@/features/cashier/components/payment/use-payment-form"
import type { CartItem, TransactionResult } from "@/features/cashier/types"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { createIdempotencyKey } from "@/lib/api/client"
import type { AddToCartItem } from "../quick-access/types"

/**
 * One PPOB purchase, paid where it was looked up.
 *
 * The PPOB page used to drop the confirmed line into the cashier's cart and
 * send the cashier to the sales screen to finish it there. An inquiry expires
 * within minutes, the cart may already hold someone else's half-rung sale, and
 * the shop wants bills kept apart from goods in its history — so the purchase
 * is now rung up here, on its own, in the `ppob` channel.
 *
 * Three states, in order: `sale` (the payment dialog is open for it), then
 * `result` (paid; the result dialog shows what the provider did with it),
 * then neither. A sale without an open shift is not started: the shift dialog
 * is shown first, because a sale booked outside a shift never reaches the
 * drawer count.
 */
export interface PpobCheckoutState {
  /** What is being paid right now, or `null` between purchases. */
  sale: DirectSale | null
  /** The sale just rung up, until the cashier is done reading the result. */
  result: TransactionResult | null
  /** No shift is open, so `sale` waits behind the shift dialog. */
  needsShift: boolean
  begin: (item: AddToCartItem) => void
  /** The cashier backed out of paying; the line goes back to the confirm card. */
  cancel: () => void
  onPaid: (result: TransactionResult) => void
  /** The result has been read; make room for the next purchase. */
  finish: () => void
}

/**
 * The confirmed line, in the shape the payment dialog charges. `key` keeps
 * the id unique without a counter: a page may start several purchases.
 */
export function toCartItem(item: AddToCartItem, key: string): CartItem {
  const sellPrice = item.price
  return {
    cart_id: `ppob-direct-${key}`,
    product_name: item.name,
    product_price: sellPrice,
    quantity: 1,
    stock: 0,
    unit: "pcs",
    is_ppob: true,
    service_type: item.service_type,
    service_ref: item.service_ref,
    buy_price: item.buy_price ?? sellPrice,
    sell_price: sellPrice,
    ppob_product_id: item.ppob_product_id,
    ppob_product_code: item.ppob_product_code,
    ppob_inquiry_id: item.ppob_inquiry_id,
    ppob_payment_code: item.ppob_payment_code,
    ppob_flag_id: item.ppob_flag_id,
  }
}

export function usePpobCheckout(): PpobCheckoutState {
  const [sale, setSale] = useState<DirectSale | null>(null)
  const [result, setResult] = useState<TransactionResult | null>(null)
  const activeShift = useShiftStore((s) => s.activeShift)
  const fetchActiveShift = useShiftStore((s) => s.fetchActiveShift)

  // The shift store is not persisted and the cashier may open this page
  // straight after logging in, before the sales screen has ever asked.
  useEffect(() => {
    void fetchActiveShift()
  }, [fetchActiveShift])

  const begin = useCallback((item: AddToCartItem) => {
    // Minted once per purchase and reused by every retry of it, so a lost
    // response replays the same sale instead of buying a second token.
    const key = createIdempotencyKey()
    setSale({ items: [toCartItem(item, key)], channel: "ppob", idempotencyKey: key })
  }, [])

  const cancel = useCallback(() => setSale(null), [])

  const onPaid = useCallback((paid: TransactionResult) => {
    setSale(null)
    setResult(paid)
  }, [])

  const finish = useCallback(() => setResult(null), [])

  return { sale, result, needsShift: !activeShift, begin, cancel, onPaid, finish }
}

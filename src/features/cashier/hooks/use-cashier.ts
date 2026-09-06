import { useApiMutation } from "@/hooks/use-api"
import { checkoutTransaction } from "@/lib/api/transactions"
import type { CheckoutTransactionInput, TransactionResult } from "../types"
import { useCartStore } from "./use-cart-store"

export { getProductByBarcode } from "@/lib/api/products"

/**
 * Ring up the cart.
 *
 * The `Idempotency-Key` comes from the cart, not from this hook, and that is the
 * whole design: it has to survive a failed attempt and a page reload so that a
 * retry is recognised as the same sale. `getCheckoutKey` mints one on the first
 * attempt and hands back the same one afterwards, until the cart is emptied.
 */
export function useCheckoutTransaction() {
  return useApiMutation<TransactionResult, CheckoutTransactionInput>((input) =>
    checkoutTransaction(input, useCartStore.getState().getCheckoutKey())
  )
}

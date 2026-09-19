import { useApiMutation } from "@/hooks/use-api"
import { checkoutTransaction } from "@/lib/api/transactions"
import type { CheckoutTransactionInput, TransactionResult } from "../types"
import { useCartStore } from "@/stores/cart-store"

export { getProductByBarcode } from "@/lib/api/products"

/**
 * Ring up a sale.
 *
 * The `Idempotency-Key` comes from the cart, not from this hook, and that is the
 * whole design: it has to survive a failed attempt and a page reload so that a
 * retry is recognised as the same sale. `getCheckoutKey` mints one on the first
 * attempt and hands back the same one afterwards, until the cart is emptied.
 *
 * A sale that is not the cart (the PPOB page pays its one line on the spot)
 * brings its own `idempotencyKey`, minted when that sale started and kept for
 * every retry of it, for the same reason.
 */
export function useCheckoutTransaction(idempotencyKey?: string) {
  return useApiMutation<TransactionResult, CheckoutTransactionInput>((input) =>
    checkoutTransaction(input, idempotencyKey ?? useCartStore.getState().getCheckoutKey()),
  )
}

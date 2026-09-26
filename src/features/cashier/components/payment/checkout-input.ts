import type {
  CartItem,
  CheckoutTransactionInput,
  TransactionChannel,
  TransactionItemInput,
} from "../../types"
import type { PaymentSummary } from "./payment-splits"

interface CheckoutInputArgs {
  items: CartItem[]
  payment: Pick<PaymentSummary, "paymentMethod" | "paymentAmount" | "paymentBreakdown">
  /** Per-line discount in rupiah; 0 = none. */
  itemDiscount: (item: CartItem) => number
  /** Whole-sale discount in rupiah; 0 = none. */
  transactionDiscount: number
  /** Omitted for the cart, which the server books as `sales`. */
  channel?: TransactionChannel
  notes: string
  /** Only when the sale carries a PPOB line — see `usePaymentForm`. */
  ppobPin?: string
}

/**
 * A goods line names its product and lets the server price it; a PPOB line
 * has no product row, so it carries its own name and price.
 */
function toItemInput(item: CartItem, discount: number): TransactionItemInput {
  return {
    product_id: item.is_ppob ? undefined : item.product_id,
    quantity: item.quantity,
    product_name: item.is_ppob ? item.product_name : undefined,
    product_price: item.is_ppob ? item.product_price : undefined,
    buy_price: item.buy_price,
    item_discount: discount || undefined,
    service_type: item.service_type,
    service_ref: item.service_ref,
    ppob_product_id: item.ppob_product_id,
    ppob_product_code: item.ppob_product_code,
    ppob_inquiry_id: item.ppob_inquiry_id,
    ppob_payment_code: item.ppob_payment_code,
    ppob_flag_id: item.ppob_flag_id,
  }
}

/** The `POST /transactions` body for one payment-dialog sale. */
export function buildCheckoutInput({
  items,
  payment,
  itemDiscount,
  transactionDiscount,
  channel,
  notes,
  ppobPin,
}: CheckoutInputArgs): CheckoutTransactionInput {
  return {
    items: items.map((item) => toItemInput(item, itemDiscount(item))),
    payment_method: payment.paymentMethod,
    payment_amount: payment.paymentAmount,
    payment_breakdown: payment.paymentBreakdown,
    transaction_discount: transactionDiscount || undefined,
    channel,
    notes: notes.trim() || undefined,
    ppob_pin: ppobPin,
  }
}

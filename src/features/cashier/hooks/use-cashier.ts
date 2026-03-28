import { invoke } from "@tauri-apps/api/core"
import { useTauriMutation } from "@/hooks/use-tauri-command"
import type { Product } from "@/features/products/types"
import type { CheckoutTransactionInput, TransactionResult } from "../types"

export function useCheckoutTransaction() {
  return useTauriMutation<
    TransactionResult,
    { input: CheckoutTransactionInput }
  >("checkout_transaction")
}

export async function getProductByBarcode(
  barcode: string
): Promise<Product | null> {
  return invoke<Product | null>("get_product_by_barcode", { barcode })
}

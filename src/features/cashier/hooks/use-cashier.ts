import { invoke } from "@tauri-apps/api/core"
import { useTauriMutation } from "@/hooks/use-tauri-command"
import type { Product } from "@/features/products/types"
import type { CreateTransactionInput, TransactionResult } from "../types"

export function useCreateTransaction() {
  return useTauriMutation<
    TransactionResult,
    { input: CreateTransactionInput }
  >("create_transaction")
}

export async function getProductByBarcode(
  barcode: string
): Promise<Product | null> {
  return invoke<Product | null>("get_product_by_barcode", { barcode })
}

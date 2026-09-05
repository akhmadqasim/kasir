import { useQueryClient, keepPreviousData, type QueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/toast"
import { useTauriQuery, useTauriMutation } from "@/hooks/use-tauri-command"
import type {
  StockWriteoff,
  CreateStockWriteoffInput,
  ListWriteoffsParams,
  ListWriteoffsResult,
} from "../types"

/**
 * Every write-off mutation moves `products.stock`: creating one decrements it, and
 * rejecting or deleting one puts it back. Invalidating only the write-off list left the
 * product picker validating "Maks. stok tersedia" against a stale number.
 */
function invalidateWriteoffQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["list_stock_writeoffs"] })
  queryClient.invalidateQueries({ queryKey: ["search_products"] })
  queryClient.invalidateQueries({ queryKey: ["get_low_stock_products"] })
}

export function useListWriteoffs(params: ListWriteoffsParams) {
  return useTauriQuery<ListWriteoffsResult>(
    "list_stock_writeoffs",
    { input: params },
    { placeholderData: keepPreviousData }
  )
}

export function useCreateWriteoff() {
  const queryClient = useQueryClient()
  return useTauriMutation<StockWriteoff, { input: CreateStockWriteoffInput; callerId: number }>(
    "create_stock_writeoff",
    {
      onSuccess: () => {
        invalidateWriteoffQueries(queryClient)
        toast.success("Write-off berhasil dibuat")
      },
      onError: (error) => {
        toast.error(error.message || "Gagal membuat write-off")
      },
    }
  )
}

export function useApproveWriteoff() {
  const queryClient = useQueryClient()
  return useTauriMutation<StockWriteoff, { writeoffId: number; callerId: number }>(
    "approve_stock_writeoff",
    {
      onSuccess: () => {
        invalidateWriteoffQueries(queryClient)
        toast.success("Write-off berhasil disetujui")
      },
      onError: (error) => {
        toast.error(error.message || "Gagal menyetujui write-off")
      },
    }
  )
}

export function useRejectWriteoff() {
  const queryClient = useQueryClient()
  return useTauriMutation<StockWriteoff, { writeoffId: number; callerId: number }>(
    "reject_stock_writeoff",
    {
      onSuccess: () => {
        invalidateWriteoffQueries(queryClient)
        toast.success("Write-off ditolak, stok dikembalikan")
      },
      onError: (error) => {
        toast.error(error.message || "Gagal menolak write-off")
      },
    }
  )
}

export function useDeleteWriteoff() {
  const queryClient = useQueryClient()
  return useTauriMutation<void, { writeoffId: number; callerId: number }>(
    "delete_stock_writeoff",
    {
      onSuccess: () => {
        invalidateWriteoffQueries(queryClient)
        toast.success("Write-off berhasil dihapus")
      },
      onError: (error) => {
        toast.error(error.message || "Gagal menghapus write-off")
      },
    }
  )
}

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
      // `create_stock_writeoff` deducts the stock straight away and only then
      // decides the status: an admin's write-off lands `approved`, a cashier's
      // lands `pending` and waits for one. A flat "berhasil dibuat" told the
      // cashier the job was done while it was still sitting in a queue.
      onSuccess: (writeoff) => {
        invalidateWriteoffQueries(queryClient)
        toast.success(
          writeoff.status === "pending"
            ? "Write-off dibuat dan stok sudah dikurangi. Menunggu persetujuan admin."
            : "Write-off dibuat dan disetujui, stok sudah dikurangi"
        )
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
      // Approval only flips the status. The stock left the shelf when the
      // write-off was created and `approve_stock_writeoff` deliberately does not
      // touch it again.
      onSuccess: () => {
        invalidateWriteoffQueries(queryClient)
        toast.success("Write-off disetujui, stok tidak berubah lagi")
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
      // A refund-originated write-off never deducted stock — the unit left at sale
      // time — so `reject_stock_writeoff` skips the restore for those rows.
      onSuccess: (writeoff) => {
        invalidateWriteoffQueries(queryClient)
        toast.success(
          writeoff.refundId === null
            ? "Write-off ditolak, stok dikembalikan"
            : "Write-off ditolak. Stok tidak dikembalikan karena berasal dari refund"
        )
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
        toast.success("Write-off dihapus, stok dikembalikan")
      },
      onError: (error) => {
        toast.error(error.message || "Gagal menghapus write-off")
      },
    }
  )
}

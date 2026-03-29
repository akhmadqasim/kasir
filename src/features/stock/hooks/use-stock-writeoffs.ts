import { useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTauriQuery, useTauriMutation } from "@/hooks/use-tauri-command"
import type {
  StockWriteoff,
  CreateStockWriteoffInput,
  ListWriteoffsParams,
  ListWriteoffsResult,
} from "../types"

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
        queryClient.invalidateQueries({ queryKey: ["list_stock_writeoffs"] })
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
        queryClient.invalidateQueries({ queryKey: ["list_stock_writeoffs"] })
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
        queryClient.invalidateQueries({ queryKey: ["list_stock_writeoffs"] })
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
        queryClient.invalidateQueries({ queryKey: ["list_stock_writeoffs"] })
        toast.success("Write-off berhasil dihapus")
      },
      onError: (error) => {
        toast.error(error.message || "Gagal menghapus write-off")
      },
    }
  )
}

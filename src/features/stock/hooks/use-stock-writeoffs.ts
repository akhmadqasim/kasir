import { useQueryClient, keepPreviousData, type QueryClient } from "@tanstack/react-query"
import { id } from "@/i18n/id"
import { toast } from "@/lib/toast"
import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import {
  approveWriteoff,
  createWriteoff,
  deleteWriteoff,
  listWriteoffs,
  rejectWriteoff,
} from "@/lib/api/stock"
import { queryKeys } from "@/lib/api/query-keys"
import type {
  StockWriteoff,
  CreateStockWriteoffInput,
  ListWriteoffsParams,
  ListWriteoffsResult,
} from "../types"

/**
 * Every write-off mutation moves `products.stock`: creating one decrements it,
 * and rejecting or deleting one puts it back. Invalidating only the write-off
 * list left the product picker validating "Maks. stok tersedia" against a stale
 * number, and the dashboard's low-stock panel showing a shelf that had already
 * been emptied. The loss report (approved write-offs) and the current-stock
 * report read the same rows.
 */
function invalidateWriteoffQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: queryKeys.stock.all })
  queryClient.invalidateQueries({ queryKey: queryKeys.products.all })
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.lowStock })
  queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
}

export function useListWriteoffs(params: ListWriteoffsParams) {
  return useApiQuery<ListWriteoffsResult>(
    queryKeys.stock.writeoffs(params),
    () => listWriteoffs(params),
    { placeholderData: keepPreviousData },
  )
}

export function useCreateWriteoff() {
  const queryClient = useQueryClient()

  return useApiMutation<StockWriteoff, CreateStockWriteoffInput>(createWriteoff, {
    // Creating a write-off deducts the stock straight away and only then decides
    // the status: an admin's lands `approved`, a cashier's lands `pending` and
    // waits for one. A flat "berhasil dibuat" told the cashier the job was done
    // while it was still sitting in a queue.
    onSuccess: (writeoff) => {
      invalidateWriteoffQueries(queryClient)
      toast.success(
        writeoff.status === "pending" ? id.writeoff.createdPending : id.writeoff.createdApproved,
      )
    },
    onError: (error) => {
      toast.error(error.message || id.writeoff.createFailed)
    },
  })
}

export function useApproveWriteoff() {
  const queryClient = useQueryClient()

  return useApiMutation<StockWriteoff, number>(approveWriteoff, {
    // Approval only flips the status. The stock left the shelf when the
    // write-off was created and the service deliberately does not touch it again.
    onSuccess: () => {
      invalidateWriteoffQueries(queryClient)
      toast.success(id.writeoff.approved)
    },
    onError: (error) => {
      toast.error(error.message || id.writeoff.approveFailed)
    },
  })
}

export function useRejectWriteoff() {
  const queryClient = useQueryClient()

  return useApiMutation<StockWriteoff, number>(rejectWriteoff, {
    // A refund-originated write-off never deducted stock — the unit left at sale
    // time — so rejecting one skips the restore.
    onSuccess: (writeoff) => {
      invalidateWriteoffQueries(queryClient)
      toast.success(
        writeoff.refundId === null ? id.writeoff.rejected : id.writeoff.rejectedFromRefund,
      )
    },
    onError: (error) => {
      toast.error(error.message || id.writeoff.rejectFailed)
    },
  })
}

export function useDeleteWriteoff() {
  const queryClient = useQueryClient()

  return useApiMutation<void, number>(deleteWriteoff, {
    onSuccess: () => {
      invalidateWriteoffQueries(queryClient)
      toast.success(id.writeoff.deleted)
    },
    onError: (error) => {
      toast.error(error.message || id.writeoff.deleteFailed)
    },
  })
}

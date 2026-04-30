import { keepPreviousData } from "@tanstack/react-query"
import { useTauriQuery } from "@/hooks/use-tauri-command"
import type { HistoryPaymentItem, HistoryDetailItem, MutasiItem } from "../types"

export function usePpobHistory(startDate: string, endDate: string) {
  return useTauriQuery<HistoryPaymentItem[]>(
    "ppob_get_history",
    { startDate, endDate },
    {
      enabled: !!startDate && !!endDate,
      placeholderData: keepPreviousData,
      staleTime: 30000,
      retry: false,
    }
  )
}

export function usePpobHistoryDetail(trxId: string | null) {
  return useTauriQuery<HistoryDetailItem>(
    "ppob_get_history_detail",
    { trxId: trxId! },
    {
      enabled: !!trxId,
      staleTime: 60000,
      retry: false,
    }
  )
}

export function usePpobMutasi(startDate: string, endDate: string) {
  return useTauriQuery<MutasiItem[]>(
    "ppob_get_mutasi",
    { startDate, endDate },
    {
      enabled: !!startDate && !!endDate,
      placeholderData: keepPreviousData,
      staleTime: 30000,
      retry: false,
    }
  )
}

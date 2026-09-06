import { keepPreviousData } from "@tanstack/react-query"
import { useApiQuery } from "@/hooks/use-api"
import { getPpobHistory, getPpobMutasi } from "@/lib/api/ppob"
import { queryKeys } from "@/lib/api/query-keys"
import type { HistoryPaymentItem, MutasiItem } from "../types"

export function usePpobHistory(startDate: string, endDate: string) {
  return useApiQuery<HistoryPaymentItem[]>(
    queryKeys.ppob.history({ startDate, endDate }),
    () => getPpobHistory(startDate, endDate),
    {
      enabled: !!startDate && !!endDate,
      placeholderData: keepPreviousData,
      staleTime: 30000,
      retry: false,
    },
  )
}

export function usePpobMutasi(startDate: string, endDate: string) {
  return useApiQuery<MutasiItem[]>(
    queryKeys.ppob.mutasi({ startDate, endDate }),
    () => getPpobMutasi(startDate, endDate),
    {
      enabled: !!startDate && !!endDate,
      placeholderData: keepPreviousData,
      staleTime: 30000,
      retry: false,
    },
  )
}

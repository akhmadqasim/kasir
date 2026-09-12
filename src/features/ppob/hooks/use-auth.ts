import { useApiQuery } from "@/hooks/use-api"
import { getPpobBalance } from "@/lib/api/ppob"
import { queryKeys } from "@/lib/api/query-keys"
import type { PpobSaldoResponse } from "../types"

export function usePpobSaldo() {
  return useApiQuery<PpobSaldoResponse>(queryKeys.ppob.balance, getPpobBalance, {
    refetchInterval: 60000,
    retry: false,
  })
}

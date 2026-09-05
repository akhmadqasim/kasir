import { useTauriQuery } from "@/hooks/use-tauri-command"
import type { PpobSaldoResponse } from "../types"

export function usePpobSaldo() {
  return useTauriQuery<PpobSaldoResponse>("ppob_get_saldo", undefined, {
    refetchInterval: 60000,
    retry: false,
  })
}

export interface PpobSaldoResponse {
  saldo: number
  username: string
  storeName: string
  flagMember: string
}

// One definition, owned by the settings the markup is saved with.
export type { PpobMarkup, PpobMarkupConfig } from "@/features/settings/types"

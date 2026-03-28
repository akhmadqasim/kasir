export interface PpobSaldoResponse {
  saldo: number
  username: string
  storeName: string
  flagMember: string
}

export interface PpobMarkupConfig {
  type: "fixed" | "percentage"
  value: number
}

export interface PpobMarkup {
  pulsa: PpobMarkupConfig
  data: PpobMarkupConfig
  pln: PpobMarkupConfig
  pdam: PpobMarkupConfig
  bpjs: PpobMarkupConfig
  emoney: PpobMarkupConfig
  custom_prices: Record<string, number>
}

export interface PpobSettings {
  enabled: boolean
  phone_number: string
  password: string
  device_id: string
  pin: string
  markup: PpobMarkup
}

export interface AppSettingsWithPpob {
  sales: {
    allow_negative_stock: boolean
    default_payment_method: string
  }
  security: {
    session_timeout_minutes: number
  }
  ppob: PpobSettings
}

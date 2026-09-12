export interface PrinterSettings {
  printer_id: string | null
  paper_width: number | null
  auto_print: boolean | null
  footer_text: string | null
}

export interface PrinterInfo {
  id: string
  name: string
  printer_type: string
  is_default: boolean
}

export interface SalesSettings {
  allow_negative_stock: boolean
  default_payment_method: string
}

export interface SecuritySettings {
  session_timeout_minutes: number
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

/**
 * PPOB settings as the server is willing to send them.
 *
 * The password and the PIN are deliberately missing. `GET /api/settings` used
 * to hand a shop's payment-gateway credentials to anyone who could call it,
 * which on a LAN is anyone who can reach the port. What comes back now is
 * `has_credentials` — whether both are stored — and nothing else.
 */
export interface PpobSettings {
  enabled: boolean
  phone_number: string
  device_id: string
  has_credentials: boolean
  markup: PpobMarkup
}

/** What `PUT /api/settings` accepts for PPOB: everything except the secrets. */
export interface UpdatePpobSettingsInput {
  enabled: boolean
  phone_number: string
  device_id: string
  markup: PpobMarkup
}

/**
 * The only way to change the credentials, through `PUT /api/settings/ppob/credentials`.
 * Saving markup settings therefore cannot blank them by omission.
 */
export interface UpdatePpobCredentialsInput {
  password: string
  pin: string
}

export interface BackupSettings {
  interval_hours: number
  retention_days: number
}

export interface BackupInfo {
  filename: string
  size_bytes: number
  created_at: string
}

export interface BackupStatus {
  last_backup: BackupInfo | null
  total_backups: number
  total_size_bytes: number
  backup_dir: string
  settings: BackupSettings
}

export interface AppSettings {
  sales: SalesSettings
  security: SecuritySettings
  ppob: PpobSettings
  backup: BackupSettings
}

export interface UpdateAppSettingsInput {
  sales: SalesSettings
  security: SecuritySettings
  ppob: UpdatePpobSettingsInput
  backup: BackupSettings
}

export interface UpdateStoreInfoInput {
  name: string
  address?: string | null
  phone?: string | null
  email?: string | null
}

export interface StoreInfo {
  id: number
  name: string
  address: string | null
  phone: string | null
  email: string | null
  logo_path: string | null
  additional_info: string | null
  created_at: string | null
  updated_at: string | null
}

export interface DatabaseInfo {
  size_bytes: number
  path: string
}

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

export interface AppSettings {
  sales: SalesSettings
  security: SecuritySettings
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

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

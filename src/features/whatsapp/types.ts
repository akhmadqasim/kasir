/** Mirrors `crate::whatsapp::WhatsappPhase`'s `state` tag. */
export type WhatsappState = "off" | "starting" | "qr_pending" | "ready" | "disconnected"

export interface WhatsappStatus {
  /** The persisted setting — survives a restart, independent of `state`. */
  enabled: boolean
  state: WhatsappState
  /** Present only for `state: "qr_pending"`, and only when this client is the till. */
  qr?: string
  /** Present only for `state: "ready"`. */
  number?: string
  /** Present only for `state: "disconnected"`. */
  reason?: string
}

export interface WhatsappSettings {
  caption_template: string
}

export interface WhatsappSendRecord {
  phone: string
  status: "sent" | "failed"
  error: string | null
  sent_at: string | null
}

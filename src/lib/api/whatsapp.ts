import type {
  WhatsappSendRecord,
  WhatsappSettings,
  WhatsappStatus,
} from "@/features/whatsapp/types"
import { apiGet, apiPost, apiPut } from "./client"

/**
 * The WhatsApp sidecar, driven from Rust and reported here.
 *
 * `enable`/`disable`/`logout` are loopback-only on the server (only the till's
 * own window may call them) and admin-only; `status` and `send-receipt` are
 * open to any session — see `http/routes/whatsapp.rs`.
 */

export function getWhatsappStatus(): Promise<WhatsappStatus> {
  return apiGet<WhatsappStatus>("/whatsapp/status")
}

export function enableWhatsapp(): Promise<WhatsappStatus> {
  return apiPost<WhatsappStatus>("/whatsapp/enable")
}

export function disableWhatsapp(): Promise<WhatsappStatus> {
  return apiPost<WhatsappStatus>("/whatsapp/disable")
}

export function logoutWhatsapp(): Promise<void> {
  return apiPost<void>("/whatsapp/logout")
}

export function getWhatsappSettings(): Promise<WhatsappSettings> {
  return apiGet<WhatsappSettings>("/whatsapp/settings")
}

export function updateWhatsappSettings(input: WhatsappSettings): Promise<void> {
  return apiPut<void>("/whatsapp/settings", input)
}

export interface SendWhatsappReceiptInput {
  transaction_id: number
  phone: string
}

export function sendWhatsappReceipt(input: SendWhatsappReceiptInput): Promise<void> {
  return apiPost<void>("/whatsapp/send-receipt", input)
}

export function getWhatsappSends(transactionId: number): Promise<WhatsappSendRecord[]> {
  return apiGet<WhatsappSendRecord[]>("/whatsapp/sends", { transaction_id: transactionId })
}

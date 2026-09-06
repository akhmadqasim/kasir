import type { PrinterInfo, PrinterSettings } from "@/features/settings/types"
import { apiGet, apiPost, apiPut } from "./client"

/**
 * The thermal printer, which is honestly machine-bound.
 *
 * The printer is plugged into the till the server runs on, so every one of
 * these produces paper *there*, whichever tablet on the LAN pressed the button.
 * That is the intended behaviour for a single-counter shop and it is written
 * down in `deploy/README.md`. Nothing here tries to print from the browser.
 */

export function listPrinters(): Promise<PrinterInfo[]> {
  return apiGet<PrinterInfo[]>("/printers")
}

export function getPrinterSettings(): Promise<PrinterSettings> {
  return apiGet<PrinterSettings>("/printers/settings")
}

export function updatePrinterSettings(input: PrinterSettings): Promise<void> {
  return apiPut<void>("/printers/settings", input)
}

export function testPrint(): Promise<void> {
  return apiPost<void>("/printers/test")
}

/**
 * Print a sale's receipt. Success means the job reached the printer, not that
 * paper came out — nothing in the ESC/POS path can tell the difference.
 */
export function printReceipt(transactionId: number): Promise<void> {
  return apiPost<void>(`/transactions/${transactionId}/print`)
}

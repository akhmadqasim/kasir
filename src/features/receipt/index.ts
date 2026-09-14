// Receipt module
//
// Printing itself is not here: it happens on the server, through
// `printReceipt` in `@/lib/api/printers`, because the thermal printer is
// plugged into the till the server runs on. What lives here is the HTML
// rendering of a receipt.
export { generateReceiptHtml } from "./utils/print-receipt"
export { ReceiptPreview } from "./components/receipt-preview"
export { receiptColumns, renderReceiptPng } from "./utils/receipt-png"
export type { ReceiptData, ReceiptItem, ReceiptLine } from "./types"

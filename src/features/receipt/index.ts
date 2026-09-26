// Receipt module
//
// Printing itself is not here: it happens on the server, through
// `printReceipt` in `@/lib/api/printers`, because the thermal printer is
// plugged into the till the server runs on. What lives here is the on-screen
// preview, drawn from the same lines the server sends to the printer, and the
// PNG rendering of those lines.
export { ReceiptPreview } from "./components/receipt-preview"
export { receiptColumns, renderReceiptPng } from "./utils/receipt-png"
export type { ReceiptLine } from "./types"

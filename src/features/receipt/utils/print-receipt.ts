import { invoke } from "@tauri-apps/api/core"
import type { ReceiptData } from "../types"

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  ewallet: "E-Wallet",
  transfer: "Transfer Bank",
}

function formatRupiah(amount: number): string {
  const rounded = Math.round(amount)
  return rounded.toLocaleString("id-ID")
}

function generateReceiptHtml(data: ReceiptData, paperWidth: number): string {
  const width = paperWidth === 80 ? "72mm" : "48mm"

  const itemsHtml = data.items
    .map(
      (item) => `
      <tr>
        <td colspan="3" class="item-name">${item.name}</td>
      </tr>
      <tr>
        <td class="item-qty">${item.quantity} x ${formatRupiah(item.price)}</td>
        <td></td>
        <td class="item-subtotal">${formatRupiah(item.subtotal)}</td>
      </tr>`
    )
    .join("")

  const paymentLabel = PAYMENT_LABELS[data.payment_method] ?? data.payment_method
  const isCash = data.payment_method === "cash"

  const footerLines = data.footer_text
    ? data.footer_text
        .split("\n")
        .map((line: string) => `<div>${line}</div>`)
        .join("")
    : `<div>Terima kasih!</div><div>Barang yang sudah dibeli</div><div>tidak dapat dikembalikan</div>`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Struk ${data.receipt_number}</title>
<style>
  @page {
    size: ${width} auto;
    margin: 0;
  }
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  body {
    font-family: 'Courier New', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.3;
    width: ${width};
    padding: 2mm;
    color: #000;
  }
  .header {
    text-align: center;
    margin-bottom: 4px;
  }
  .store-name {
    font-weight: bold;
    font-size: 14px;
  }
  .divider {
    border-top: 1px dashed #000;
    margin: 4px 0;
  }
  .divider-double {
    border-top: 2px solid #000;
    margin: 4px 0;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
  }
  .info-label {
    flex-shrink: 0;
  }
  .info-value {
    text-align: right;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  .item-name {
    padding-top: 2px;
  }
  .item-qty {
    padding-left: 8px;
    font-size: 11px;
  }
  .item-subtotal {
    text-align: right;
    white-space: nowrap;
  }
  .total-row {
    font-weight: bold;
    font-size: 13px;
  }
  .total-row td {
    padding-top: 2px;
  }
  .footer {
    text-align: center;
    margin-top: 6px;
    font-size: 11px;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="store-name">${data.store_name}</div>
    ${data.store_address ? `<div>${data.store_address}</div>` : ""}
    ${data.store_phone ? `<div>Telp: ${data.store_phone}</div>` : ""}
  </div>

  <div class="divider-double"></div>

  <div class="info-row"><span class="info-label">No:</span><span class="info-value">${data.receipt_number}</span></div>
  <div class="info-row"><span class="info-label">Tanggal:</span><span class="info-value">${data.date_time}</span></div>
  <div class="info-row"><span class="info-label">Kasir:</span><span class="info-value">${data.cashier_name}</span></div>

  <div class="divider"></div>

  <table>
    ${itemsHtml}
  </table>

  <div class="divider"></div>

  <table>
    <tr class="total-row">
      <td>TOTAL</td>
      <td></td>
      <td style="text-align:right">${formatRupiah(data.total_amount)}</td>
    </tr>
    <tr>
      <td>Bayar (${paymentLabel})</td>
      <td></td>
      <td style="text-align:right">${formatRupiah(data.payment_amount)}</td>
    </tr>
    ${
      isCash && data.change_amount > 0
        ? `<tr>
      <td>Kembalian</td>
      <td></td>
      <td style="text-align:right">${formatRupiah(data.change_amount)}</td>
    </tr>`
        : ""
    }
  </table>

  ${data.notes ? `<div class="divider"></div>
  <div style="font-size: 11px;">Catatan: ${data.notes}</div>` : ""}

  <div class="divider-double"></div>

  <div class="footer">
    ${footerLines}
  </div>
</body>
</html>`
}

export async function printReceipt(transactionId: number): Promise<void> {
  const data = await invoke<ReceiptData>("get_receipt_data", { transactionId })
  const settings = await invoke<{ paper_width: number | null }>(
    "get_printer_settings_cmd"
  )
  const paperWidth = settings.paper_width ?? 58

  const html = generateReceiptHtml(data, paperWidth)

  // Create a hidden iframe for printing
  const iframe = document.createElement("iframe")
  iframe.style.position = "fixed"
  iframe.style.top = "-10000px"
  iframe.style.left = "-10000px"
  iframe.style.width = "0"
  iframe.style.height = "0"
  iframe.style.border = "none"
  document.body.appendChild(iframe)

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
  if (!iframeDoc) {
    document.body.removeChild(iframe)
    throw new Error("Gagal membuat iframe untuk print")
  }

  iframeDoc.open()
  iframeDoc.write(html)
  iframeDoc.close()

  // Wait for content to render
  await new Promise((resolve) => setTimeout(resolve, 300))

  // Print
  iframe.contentWindow?.print()

  // Clean up after a delay
  setTimeout(() => {
    document.body.removeChild(iframe)
  }, 2000)
}

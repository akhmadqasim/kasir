import { invoke } from "@tauri-apps/api/core"
import type { ReceiptData } from "../types"

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  debit: "Debit",
  ewallet: "E-Wallet",
  transfer: "Transfer Bank",
  mixed: "Campuran",
}

function formatPaymentSplitLabel(paymentMethod: string, bankName?: string | null): string {
  const label = PAYMENT_LABELS[paymentMethod] ?? paymentMethod
  return bankName?.trim() ? `${label} (${bankName.trim()})` : label
}

/**
 * Nama produk, catatan dan data toko berasal dari input pengguna dan berakhir di
 * `document.write` pada iframe same-origin. Tanpa escaping, `<script>` di nama
 * produk berjalan dengan akses penuh ke seluruh Tauri command.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatRupiah(amount: number): string {
  const rounded = Math.round(amount)
  return rounded.toLocaleString("id-ID")
}

export function generateReceiptHtml(data: ReceiptData, paperWidth: number): string {
  const width = paperWidth === 80 ? "72mm" : "48mm"

  const itemsHtml = data.items
    .map(
      (item) => `
      <tr>
        <td colspan="3" class="item-name">${escapeHtml(item.name)}</td>
      </tr>
      <tr>
        <td class="item-qty">${item.quantity} x ${formatRupiah(item.price)}</td>
        <td></td>
        <td class="item-subtotal">${formatRupiah(item.subtotal)}</td>
      </tr>`
    )
    .join("")

  const paymentLabel = formatPaymentSplitLabel(
    data.payment_method,
    data.payment_breakdown[0]?.bank_name
  )
  const hasCashPayment =
    data.payment_method === "cash" ||
    data.payment_breakdown.some((split) => split.payment_method === "cash")
  const paymentRowsHtml =
    data.payment_breakdown.length > 1
      ? data.payment_breakdown
          .map(
            (split) => `
    <tr>
      <td>Bayar (${escapeHtml(formatPaymentSplitLabel(split.payment_method, split.bank_name))})</td>
      <td></td>
      <td style="text-align:right">${formatRupiah(split.amount)}</td>
    </tr>`
          )
          .join("") +
        `${
          data.change_amount > 0
            ? `
    <tr>
      <td>Dibayar</td>
      <td></td>
      <td style="text-align:right">${formatRupiah(data.payment_amount)}</td>
    </tr>
    <tr>
      <td>Kembalian</td>
      <td></td>
      <td style="text-align:right">${formatRupiah(data.change_amount)}</td>
    </tr>`
            : ""
        }`
      : `
    <tr>
      <td>Bayar (${escapeHtml(paymentLabel)})</td>
      <td></td>
      <td style="text-align:right">${formatRupiah(data.payment_amount)}</td>
    </tr>
    ${
      hasCashPayment && data.change_amount > 0
        ? `<tr>
      <td>Kembalian</td>
      <td></td>
      <td style="text-align:right">${formatRupiah(data.change_amount)}</td>
    </tr>`
        : ""
    }`

  const footerLines = data.footer_text
    ? data.footer_text
        .split("\n")
        .map((line: string) => `<div>${escapeHtml(line)}</div>`)
        .join("")
    : `<div>Terima kasih!</div><div>Barang yang sudah dibeli</div><div>tidak dapat dikembalikan</div>`

  const titleSuffix = data.is_deleted ? " - VOID" : ""
  const voidInfoHtml = data.is_deleted
    ? `
  <div class="divider"></div>
  ${data.deleted_by_name ? `<div class="info-row"><span class="info-label">Void By:</span><span class="info-value">${escapeHtml(data.deleted_by_name)}</span></div>` : ""}
  ${data.deleted_reason ? `<div style="font-size: 11px;">Alasan Void: ${escapeHtml(data.deleted_reason)}</div>` : ""}`
    : ""

  // Samakan dengan struk ESC/POS: subtotal dan diskon sebelum baris TOTAL.
  const discountRowsHtml =
    data.discount_amount > 0
      ? `
    <tr>
      <td>Subtotal</td>
      <td></td>
      <td style="text-align:right">${formatRupiah(data.subtotal_amount)}</td>
    </tr>
    <tr>
      <td>Diskon</td>
      <td></td>
      <td style="text-align:right">-${formatRupiah(data.discount_amount)}</td>
    </tr>`
      : ""

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Struk ${escapeHtml(data.receipt_number)}${titleSuffix}</title>
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
    <div class="store-name">${escapeHtml(data.store_name)}</div>
    ${data.store_address ? `<div>${escapeHtml(data.store_address)}</div>` : ""}
    ${data.store_phone ? `<div>Telp: ${escapeHtml(data.store_phone)}</div>` : ""}
    ${data.is_deleted ? `<div style="margin-top:4px;font-weight:bold;">Receipt Salinan (Void)</div>` : ""}
  </div>

  <div class="divider-double"></div>

  <div class="info-row"><span class="info-label">No:</span><span class="info-value">${escapeHtml(data.receipt_number)}</span></div>
  <div class="info-row"><span class="info-label">Tanggal:</span><span class="info-value">${escapeHtml(data.date_time)}</span></div>
  <div class="info-row"><span class="info-label">Kasir:</span><span class="info-value">${escapeHtml(data.cashier_name)}</span></div>

  <div class="divider"></div>

  <table>
    ${itemsHtml}
  </table>

  <div class="divider"></div>

  <table>
    ${discountRowsHtml}
    <tr class="total-row">
      <td>TOTAL</td>
      <td></td>
      <td style="text-align:right">${formatRupiah(data.original_total_amount)}</td>
    </tr>
    ${paymentRowsHtml}
  </table>

  ${data.notes ? `<div class="divider"></div>
  <div style="font-size: 11px;">Catatan: ${escapeHtml(data.notes)}</div>` : ""}
  ${voidInfoHtml}

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

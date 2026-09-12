import { paymentSplitLabel } from "@/lib/labels"
import type { ReceiptData } from "../types"

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
      </tr>`,
    )
    .join("")

  const paymentLabel = paymentSplitLabel(data.payment_method, data.payment_breakdown[0]?.bank_name)
  // `change_amount` alone decides whether there is money to hand back. A split
  // whose non-cash legs already cover the total drops its cash leg entirely, so
  // the sale carries a single non-cash entry while the cash on the counter comes
  // back as change; requiring a cash entry left that off the receipt.
  const hasChange = data.change_amount > 0
  const paymentRowsHtml =
    data.payment_breakdown.length > 1
      ? data.payment_breakdown
          .map(
            (split) => `
    <tr>
      <td>Bayar (${escapeHtml(paymentSplitLabel(split.payment_method, split.bank_name))})</td>
      <td></td>
      <td style="text-align:right">${formatRupiah(split.amount)}</td>
    </tr>`,
          )
          .join("") +
        `${
          hasChange
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
      hasChange
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

  ${
    data.notes
      ? `<div class="divider"></div>
  <div style="font-size: 11px;">Catatan: ${escapeHtml(data.notes)}</div>`
      : ""
  }
  ${voidInfoHtml}

  <div class="divider-double"></div>

  <div class="footer">
    ${footerLines}
  </div>
</body>
</html>`
}

/*
 * There used to be a browser-side `printReceipt` here that drew this HTML into a
 * hidden iframe and called `window.print()`. It is gone, and nothing lost a
 * feature: neither of the two print buttons ever called it — both invoked the
 * Tauri `print_receipt` command, which drives the ESC/POS printer.
 *
 * That distinction now matters more than it did. The printer is plugged into the
 * till the server runs on, so printing is `POST /api/transactions/{id}/print`
 * and the paper comes out there, whichever device pressed the button. A browser
 * print dialog on a tablet in the back office would have printed to whatever
 * that tablet happens to see, which is nothing.
 *
 * `generateReceiptHtml` stays: it is the on-screen receipt preview's renderer,
 * and its HTML escaping is what keeps a product name from executing.
 */

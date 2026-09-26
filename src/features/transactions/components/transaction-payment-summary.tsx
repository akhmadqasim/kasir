import { Surface } from "@heroui/react"

import { InfoPanel } from "@/components/info-panel"
import { SummaryList, type SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import { paymentSplitLabel } from "@/lib/labels"
import { id } from "@/i18n/id"
import type { TransactionDetail } from "../types"

/** Totals, discount, method (and its split, if any), amount paid and change. */
export function TransactionPaymentSummary({ detail }: { detail: TransactionDetail }) {
  const { transaction, payment_breakdown: breakdown } = detail
  const isDeleted = transaction.status === "deleted"
  const changeAmount = transaction.change_amount ?? 0

  // Dua daftar karena rincian split, kalau ada, duduk di antara metode dan jumlah bayar.
  const paymentItems: SummaryItem[] = [
    ...(transaction.discount_amount > 0
      ? [
          { label: "Subtotal", value: formatRupiah(transaction.subtotal_amount) },
          {
            label: "Diskon",
            value: `-${formatRupiah(transaction.discount_amount)}`,
            tone: "danger" as const,
          },
        ]
      : []),
    {
      label: id.transactions.totalAmount,
      value: formatRupiah(transaction.total_amount),
      tone: "strong",
    },
    // Voiding zeroes `total_amount`; the amount the sale was worth stays readable here.
    ...(isDeleted
      ? [
          {
            label: "Total sebelum hapus",
            value: formatRupiah(
              Math.max(transaction.subtotal_amount - transaction.discount_amount, 0),
            ),
          },
        ]
      : []),
    {
      label: id.transactions.paymentMethod,
      value: paymentSplitLabel(transaction.payment_method, breakdown[0]?.bank_name),
    },
  ]
  const settlementItems: SummaryItem[] = [
    { label: id.transactions.paymentAmount, value: formatRupiah(transaction.payment_amount) },
    ...(changeAmount > 0
      ? [{ label: id.transactions.changeAmount, value: formatRupiah(changeAmount) }]
      : []),
  ]

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-foreground">Ringkasan Pembayaran</h3>
      <InfoPanel className="flex flex-col gap-2">
        <SummaryList items={paymentItems} />
        {breakdown.length > 1 && (
          /* Bersarang di dalam kotak `secondary`, jadi memakai `default`
             supaya rinciannya masih terlihat sebagai kotak tersendiri. */
          <Surface className="px-3 py-2" variant="default">
            <SummaryList
              items={breakdown.map((split) => ({
                label: paymentSplitLabel(split.payment_method, split.bank_name),
                value: formatRupiah(split.amount),
              }))}
            />
          </Surface>
        )}
        <SummaryList items={settlementItems} />
      </InfoPanel>
    </section>
  )
}

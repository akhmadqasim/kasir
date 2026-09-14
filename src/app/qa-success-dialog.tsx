import { useNavigate, useSearchParams } from "react-router-dom"
import { Spinner } from "@heroui/react"

import { useApiQuery } from "@/hooks/use-api"
import { getTransactionDetail, listTransactions } from "@/lib/api/transactions"
import { TransactionSuccessDialog } from "@/features/cashier/components/transaction-success-dialog"

/**
 * Hanya di `bun run dev`: buka `/__success` untuk melihat dialog "Transaksi
 * selesai" dengan penjualan terakhir yang ada (atau `/__success?id=2487`
 * untuk penjualan tertentu), tanpa harus menjual sesuatu dulu — pasangan
 * `/__error`. Cetak otomatis dimatikan supaya sekadar membuka halaman ini
 * tidak mengeluarkan kertas.
 */
export function SuccessDialogForQa() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requested = Number(params.get("id"))
  const latest = useApiQuery(
    ["qa", "latest-transaction"],
    () => listTransactions({ page: 1, per_page: 1 }),
    { enabled: !requested },
  )
  const id = requested || latest.data?.data[0]?.id
  const detail = useApiQuery(
    ["qa", "transaction", id ?? 0],
    () => getTransactionDetail(id as number),
    { enabled: id !== undefined },
  )

  if (!detail.data) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const { transaction, items, payment_breakdown } = detail.data
  // Riwayat mengetik `change_amount`/`created_at` sebagai nullable; hasil
  // checkout tidak — untuk pratinjau, isi kekosongannya.
  const result = {
    transaction: {
      ...transaction,
      change_amount: transaction.change_amount ?? 0,
      created_at: transaction.created_at ?? new Date().toISOString(),
    },
    items,
    payment_breakdown,
  }
  return (
    <TransactionSuccessDialog
      open
      result={result}
      autoPrint={false}
      paperWidth={null}
      onNewTransaction={() => void navigate("/cashier", { replace: true })}
    />
  )
}

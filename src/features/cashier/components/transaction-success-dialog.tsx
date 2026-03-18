import { CheckCircle2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { formatRupiah } from "../utils"
import type { TransactionResult } from "../types"

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  ewallet: "E-Wallet",
  transfer: "Transfer Bank",
}

interface TransactionSuccessDialogProps {
  open: boolean
  result: TransactionResult | null
  onNewTransaction: () => void
}

export function TransactionSuccessDialog({
  open,
  result,
  onNewTransaction,
}: TransactionSuccessDialogProps) {
  if (!result) return null

  const { transaction } = result
  const isCash = transaction.payment_method === "cash"

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-sm"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="flex flex-col items-center gap-4 pt-4">
          <CheckCircle2 className="h-16 w-16 text-green-500" />
          <h2 className="text-xl font-bold">Transaksi Berhasil!</h2>
        </div>

        <div className="space-y-3 rounded-lg bg-muted p-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">No. Struk</p>
            <p className="text-lg font-bold font-mono">
              {transaction.receipt_number}
            </p>
          </div>

          <Separator />

          <div className="flex justify-between">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold tabular-nums">
              {formatRupiah(transaction.total_amount)}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">Metode Pembayaran</span>
            <span className="font-medium">
              {PAYMENT_LABELS[transaction.payment_method] ??
                transaction.payment_method}
            </span>
          </div>

          {isCash && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Jumlah Bayar</span>
                <span className="font-medium tabular-nums">
                  {formatRupiah(transaction.payment_amount)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Kembalian</span>
                <span className="font-bold text-green-600 tabular-nums">
                  {formatRupiah(transaction.change_amount)}
                </span>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:flex-col">
          <Button variant="outline" className="w-full" disabled>
            Cetak Struk
          </Button>
          <Button className="w-full" onClick={onNewTransaction}>
            Transaksi Baru
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

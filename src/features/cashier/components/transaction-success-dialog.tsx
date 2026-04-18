import { CheckCircle2, Loader2, Printer } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { formatRupiah } from "../utils"
import type { TransactionResult } from "../types"
import { toast } from "sonner"

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
  const [isPrinting, setIsPrinting] = useState(false)
  const autoPrintedRef = useRef<number | null>(null)

  const transaction = result?.transaction
  const isCash = transaction?.payment_method === "cash"
  const ppobItem = result?.items.find((item) => item.service_type)
  const hasPpob = !!ppobItem

  // Auto-print when dialog opens with a new transaction
  useEffect(() => {
    if (!open || !transaction) return
    if (autoPrintedRef.current === transaction.id) return

    const tryAutoPrint = async () => {
      try {
        const settings = await invoke<{
          printer_id: string | null
          auto_print: boolean | null
        }>("get_printer_settings_cmd")

        if (settings.auto_print && settings.printer_id) {
          autoPrintedRef.current = transaction.id
          setIsPrinting(true)
          await invoke("print_receipt", { transactionId: transaction.id })
          toast.success("Struk otomatis dicetak!")
          setIsPrinting(false)
          setTimeout(() => onNewTransaction(), 1500)
        }
      } catch {
        setIsPrinting(false)
      }
    }
    tryAutoPrint()
  }, [onNewTransaction, open, transaction])

  if (!result || !transaction) return null

  const handlePrint = async () => {
    setIsPrinting(true)
    try {
      await invoke("print_receipt", { transactionId: transaction.id })
      toast.success("Struk berhasil dicetak!")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("belum dikonfigurasi")) {
        toast.error("Printer belum diatur. Silakan atur di menu Pengaturan.")
      } else {
        toast.error(`Gagal mencetak struk: ${message}`)
      }
    } finally {
      setIsPrinting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => onNewTransaction()}>
      <DialogContent
        className="sm:max-w-sm"
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
              <Separator />
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Jumlah Bayar</span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatRupiah(transaction.payment_amount)}
                </span>
              </div>
              <Separator />
              <div className="text-center py-3">
                <p className="text-sm text-muted-foreground mb-1">Kembalian</p>
                <p className="text-5xl font-extrabold tabular-nums tracking-tight text-green-600">
                  {formatRupiah(transaction.change_amount)}
                </p>
              </div>
            </>
          )}
          {hasPpob && (
            <>
              <Separator />
              <div className="flex items-center gap-2 text-sm text-blue-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>PPOB sedang diproses di latar belakang. Cek status di Riwayat.</span>
              </div>
            </>
          )}
          {transaction.notes && (
            <>
              <Separator />
              <div className="text-sm">
                <p className="text-muted-foreground mb-0.5">Catatan</p>
                <p>{transaction.notes}</p>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:flex-col">
          <Button
            variant="outline"
            className="w-full"
            onClick={handlePrint}
            disabled={isPrinting}
          >
            <Printer className="mr-2 h-4 w-4" />
            {isPrinting ? "Mencetak..." : "Cetak Struk"}
          </Button>
          <Button className="w-full" onClick={onNewTransaction}>
            Transaksi Baru
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useRef, useState } from "react"
import { Button, Modal, Separator } from "@heroui/react"
import { CheckCircle2, Loader2, Printer } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"

import { toast } from "@/lib/toast"
import { formatRupiah } from "../utils"
import type { TransactionResult } from "../types"

/** Jeda sebelum dialog menutup sendiri setelah struk tercetak otomatis */
const AUTO_CLOSE_DELAY_MS = 1500

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
  const paymentBreakdown = result?.payment_breakdown ?? []
  // `change_amount` alone decides whether there is money to hand back.
  //
  // A split whose non-cash legs already cover the total drops its cash leg: the
  // sale is recorded as that single method with no cash entry at all, while the
  // cash the customer put on the counter comes straight back as change. Gating
  // this on "a cash entry exists" hid the whole amount from the cashier.
  const changeAmount = transaction?.change_amount ?? 0
  const ppobItem = result?.items.find((item) => item.service_type)
  const hasPpob = !!ppobItem

  // Auto-print when dialog opens with a new transaction
  useEffect(() => {
    if (!open || !transaction) return
    if (autoPrintedRef.current === transaction.id) return

    let cancelled = false
    let closeTimer: ReturnType<typeof setTimeout> | undefined

    const tryAutoPrint = async () => {
      let settings: { printer_id: string | null; auto_print: boolean | null }
      try {
        settings = await invoke("get_printer_settings_cmd")
      } catch {
        // Printer belum diatur — cetak manual saja, tidak perlu diributkan
        return
      }

      if (cancelled) return
      if (!settings.auto_print || !settings.printer_id) return

      autoPrintedRef.current = transaction.id
      setIsPrinting(true)
      try {
        await invoke("print_receipt", { transactionId: transaction.id })
        if (cancelled) return
        toast.success("Struk otomatis dicetak!")
        closeTimer = setTimeout(() => onNewTransaction(), AUTO_CLOSE_DELAY_MS)
      } catch (error) {
        if (cancelled) return
        // Biarkan kasir mencoba lagi lewat tombol "Cetak Struk"
        autoPrintedRef.current = null
        const message = error instanceof Error ? error.message : String(error)
        toast.error(
          `Struk gagal dicetak otomatis: ${message}. Gunakan tombol "Cetak Struk".`
        )
      } finally {
        if (!cancelled) setIsPrinting(false)
      }
    }
    tryAutoPrint()

    return () => {
      cancelled = true
      // Timer yang tidak dibatalkan akan menghapus keranjang pelanggan berikutnya
      if (closeTimer) clearTimeout(closeTimer)
    }
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
    <Modal.Backdrop isOpen={open} onOpenChange={() => onNewTransaction()}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label="Transaksi Berhasil">
          <Modal.Body className="space-y-4">
            <div className="flex flex-col items-center gap-4 pt-4">
              <CheckCircle2 className="h-16 w-16 text-success" />
              <h2 className="text-xl font-bold">Transaksi Berhasil!</h2>
            </div>

            <div className="space-y-3 rounded-lg bg-default p-4">
              <div className="text-center">
                <p className="text-sm text-muted">No. Struk</p>
                <p className="font-mono text-lg font-bold">
                  {transaction.receipt_number}
                </p>
              </div>

              <Separator />

              <div className="flex justify-between">
                <span className="text-muted">Total</span>
                <span className="font-semibold tabular-nums">
                  {formatRupiah(transaction.total_amount)}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted">Metode Pembayaran</span>
                <span className="font-medium">
                  {formatPaymentSplitLabel(
                    transaction.payment_method,
                    paymentBreakdown[0]?.bank_name
                  )}
                </span>
              </div>

              {paymentBreakdown.length > 1 && (
                <>
                  <Separator />
                  <div className="space-y-2 text-sm">
                    {paymentBreakdown.map((split) => (
                      <div
                        key={`${split.payment_method}-${split.bank_name ?? "default"}`}
                        className="flex justify-between"
                      >
                        <span className="text-muted">
                          {formatPaymentSplitLabel(split.payment_method, split.bank_name)}
                        </span>
                        <span className="font-medium tabular-nums">
                          {formatRupiah(split.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {changeAmount > 0 && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Jumlah Bayar</span>
                    <span className="text-lg font-semibold tabular-nums">
                      {formatRupiah(transaction.payment_amount)}
                    </span>
                  </div>
                  <Separator />
                  <div className="py-3 text-center">
                    <p className="mb-1 text-sm text-muted">Kembalian</p>
                    <p className="text-5xl font-extrabold tracking-tight tabular-nums text-success">
                      {formatRupiah(changeAmount)}
                    </p>
                  </div>
                </>
              )}
              {hasPpob && (
                <>
                  <Separator />
                  <div className="flex items-center gap-2 text-sm text-accent">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>
                      PPOB sedang diproses di latar belakang. Cek status di Riwayat.
                    </span>
                  </div>
                </>
              )}
              {transaction.notes && (
                <>
                  <Separator />
                  <div className="text-sm">
                    <p className="mb-0.5 text-muted">Catatan</p>
                    <p>{transaction.notes}</p>
                  </div>
                </>
              )}
            </div>
          </Modal.Body>

          <Modal.Footer className="flex-col gap-2">
            <Button
              className="w-full"
              isDisabled={isPrinting}
              variant="outline"
              onPress={handlePrint}
            >
              <Printer className="mr-2 h-4 w-4" />
              {isPrinting ? "Mencetak..." : "Cetak Struk"}
            </Button>
            <Button className="w-full" onPress={onNewTransaction}>
              Transaksi Baru
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

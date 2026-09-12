import { useEffect, useRef, useState } from "react"
import { Button, Modal, Spinner } from "@heroui/react"
import { CheckCircle2, Printer } from "lucide-react"

import { InfoPanel } from "@/components/info-panel"
import { PendingButton } from "@/components/pending-button"
import { SummaryList } from "@/components/summary-list"
import { toast } from "@/lib/toast"
import { getPrinterSettings, printReceipt } from "@/lib/api/printers"
import { errorMessage } from "@/lib/api/client"
import { formatRupiah } from "../utils"
import type { PrinterSettings } from "@/features/settings/types"
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
      let settings: PrinterSettings
      try {
        settings = await getPrinterSettings()
      } catch {
        // Printer belum diatur — cetak manual saja, tidak perlu diributkan
        return
      }

      if (cancelled) return
      if (!settings.auto_print || !settings.printer_id) return

      autoPrintedRef.current = transaction.id
      setIsPrinting(true)
      try {
        await printReceipt(transaction.id)
        if (cancelled) return
        toast.success("Struk otomatis dicetak!")
        closeTimer = setTimeout(() => onNewTransaction(), AUTO_CLOSE_DELAY_MS)
      } catch (error) {
        if (cancelled) return
        // Biarkan kasir mencoba lagi lewat tombol "Cetak Struk"
        autoPrintedRef.current = null
        const message = errorMessage(error)
        toast.error(`Struk gagal dicetak otomatis: ${message}. Gunakan tombol "Cetak Struk".`)
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
      await printReceipt(transaction.id)
      toast.success("Struk berhasil dicetak!")
    } catch (error) {
      const message = errorMessage(error)
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
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-success-soft text-success-soft-foreground">
              <CheckCircle2 className="size-5" />
            </Modal.Icon>
            <Modal.Heading>Transaksi Berhasil</Modal.Heading>
          </Modal.Header>

          <Modal.Body>
            <InfoPanel className="flex flex-col gap-3">
              <SummaryList
                items={[
                  { label: "No. Struk", value: transaction.receipt_number, tone: "mono" },
                  { label: "Total", value: formatRupiah(transaction.total_amount), tone: "strong" },
                  {
                    label: "Metode Pembayaran",
                    value: formatPaymentSplitLabel(
                      transaction.payment_method,
                      paymentBreakdown[0]?.bank_name,
                    ),
                  },
                  ...(paymentBreakdown.length > 1
                    ? paymentBreakdown.map((split) => ({
                        label: formatPaymentSplitLabel(split.payment_method, split.bank_name),
                        value: formatRupiah(split.amount),
                      }))
                    : []),
                  ...(changeAmount > 0
                    ? [{ label: "Jumlah Bayar", value: formatRupiah(transaction.payment_amount) }]
                    : []),
                  ...(transaction.notes ? [{ label: "Catatan", value: transaction.notes }] : []),
                ]}
              />

              {changeAmount > 0 && (
                /* Kembalian dibaca pelanggan dari seberang meja — peran
                   "Total keranjang" di DESIGN.md §3.4. */
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-muted">Kembalian</span>
                  <span className="text-3xl font-semibold tracking-tight tabular-nums text-success">
                    {formatRupiah(changeAmount)}
                  </span>
                </div>
              )}
            </InfoPanel>
            {hasPpob && (
              <p className="flex items-center gap-2">
                <Spinner color="current" size="sm" />
                PPOB sedang diproses di latar belakang. Cek statusnya di Riwayat.
              </p>
            )}
          </Modal.Body>

          <Modal.Footer>
            <PendingButton isPending={isPrinting} variant="secondary" onPress={handlePrint}>
              <Printer />
              Cetak Struk
            </PendingButton>
            <Button onPress={onNewTransaction}>Transaksi Baru</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

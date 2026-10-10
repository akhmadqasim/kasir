import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button, Kbd, Modal, Spinner } from "@heroui/react"
import { CircleCheck, Clock, Copy, Printer } from "lucide-react"

import { PendingButton } from "@/components/pending-button"
import {
  AutoPrintStatus,
  ReceiptPreview,
  receiptColumns,
  renderReceiptPng,
  useReceiptPrint,
} from "@/features/receipt"
import { PpobLineResult } from "@/features/transactions/components/ppob-line-result"
import { usePpobCheck } from "@/features/transactions/hooks/use-ppob-check"
import { usePpobSaleProgress } from "@/features/transactions/hooks/use-ppob-sale-progress"
import { id } from "@/i18n/id"
import { useApiQuery } from "@/hooks/use-api"
import { queryKeys } from "@/lib/api/query-keys"
import { getSaleReceiptLines } from "@/lib/api/transactions"
import { toast } from "@/lib/toast"
import type { TransactionResult } from "../types"
import { ChangeTotalPanel } from "./change-total-panel"

/** Jeda sebelum dialog menutup sendiri setelah struk tercetak otomatis */
const AUTO_CLOSE_DELAY_MS = 1500

interface TransactionSuccessDialogProps {
  open: boolean
  result: TransactionResult | null
  /**
   * Pengaturan printer dibaca `CashierPage` dari cache, bukan diambil dialog
   * ini tiap kali terbuka. `undefined` selama belum termuat: cetak otomatis
   * menunggu jawabannya alih-alih menganggapnya mati.
   */
  autoPrint: boolean | undefined
  /** Lebar kertas dari pengaturan printer yang sama dipakai mencetak — dibaca
   * `CashierPage` dari cache bersama `autoPrint`, lalu diteruskan ke
   * `ReceiptPreview` supaya pratinjaunya tidak pernah beda kolom dari hasil
   * cetaknya. */
  paperWidth: number | null | undefined
  onNewTransaction: () => void
}

/**
 * The sale is already recorded; this dialog shows its result from the
 * checkout answer. A cart with PPOB lines is the exception: checkout answers
 * before the provider does, so the detail is fetched again until every PPOB
 * line has a result — see `SuccessContent`.
 */
export function TransactionSuccessDialog({
  open,
  result,
  autoPrint,
  paperWidth,
  onNewTransaction,
}: TransactionSuccessDialogProps) {
  if (!result) return null

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={() => onNewTransaction()}>
      {/* Dua sisi seperti dialog Pembayaran: kiri total, kembalian dan
          tombolnya; kanan struk persis seperti yang tercetak. Lebarnya sama
          dengan dialog Pembayaran supaya matanya tidak berpindah tempat. */}
      <Modal.Container size="lg">
        <Modal.Dialog aria-label="Transaksi selesai" className="max-w-[44rem]">
          {/* Isi dan status cetaknya ikut penjualannya: `key` mengganti
              keduanya untuk struk berikutnya, dan Modal melepasnya saat tertutup. */}
          <SuccessContent
            key={result.transaction.id}
            result={result}
            autoPrint={autoPrint}
            paperWidth={paperWidth}
            onNewTransaction={onNewTransaction}
          />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

interface SuccessContentProps extends Omit<TransactionSuccessDialogProps, "open" | "result"> {
  result: TransactionResult
}

function SuccessContent({ result, autoPrint, paperWidth, onNewTransaction }: SuccessContentProps) {
  const { transaction } = result
  const queryClient = useQueryClient()
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  // A timer left running would clear the next customer's cart.
  useEffect(() => () => clearTimeout(closeTimerRef.current), [])

  // A mixed cart: checkout answers before the provider does, so its PPOB lines
  // come back `pending` and a background task chases them. A plain sale asks
  // nothing.
  const { lines, inFlight: ppobInFlight, uncertain: ppobUncertain } = usePpobSaleProgress(result)
  const { check, checkingId } = usePpobCheck()

  // The struk preview carries the token once a line succeeds: refresh it each
  // time a line's status moves (not on the first render — it is loading anyway).
  const statusKey = lines.map((line) => `${line.id}:${line.ppob_status}`).join(",")
  const seenStatusKeyRef = useRef(statusKey)
  useEffect(() => {
    if (seenStatusKeyRef.current === statusKey) return
    seenStatusKeyRef.current = statusKey
    void queryClient.invalidateQueries({
      queryKey: queryKeys.transactions.receiptLines(transaction.id, paperWidth ?? null),
    })
  }, [statusKey, queryClient, transaction.id, paperWidth])

  // Baris struk yang sama dengan pratinjau di kanan (query yang sama, jadi
  // satu permintaan) — untuk "Salin struk".
  const receiptLines = useApiQuery(
    queryKeys.transactions.receiptLines(transaction.id, paperWidth ?? null),
    () => getSaleReceiptLines(transaction.id, paperWidth),
  )

  // Struk sebagai gambar PNG di clipboard — ditempel ke WhatsApp jadi foto
  // struk, bukan teks yang kolomnya berantakan di font proporsional.
  const handleCopy = async () => {
    const lines = receiptLines.data
    if (!lines) {
      toast.error(id.cashier.receiptNotReady)
      return
    }
    try {
      const png = await renderReceiptPng(lines, receiptColumns(paperWidth))
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
      toast.success(id.cashier.receiptCopied)
    } catch {
      toast.error(id.cashier.receiptCopyFailed)
    }
  }

  // Enter prints and C copies wherever the focus is; Esc (the Modal's own)
  // starts a new sale. Auto-print starts once its settings are known and no
  // PPOB call is in flight — printed earlier, a `pending` line has no token —
  // and the dialog closes itself after the receipt is out, unless a PPOB line
  // ended uncertain: then the cashier has to read that the token comes later.
  const copyButtonRef = useRef<HTMLButtonElement>(null)
  const {
    isPrinting,
    print: handlePrint,
    autoPrintState,
    printButtonRef,
  } = useReceiptPrint(transaction.id, {
    autoPrint: autoPrint && !ppobInFlight,
    onAutoPrinted: () => {
      if (ppobUncertain) return
      closeTimerRef.current = setTimeout(onNewTransaction, AUTO_CLOSE_DELAY_MS)
    },
    shortcuts: { c: { run: handleCopy, buttonRef: copyButtonRef } },
  })

  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header>
        {/* Ikon berstatus: `bg-success-soft`, bukan netral — DESIGN.md §5.7. */}
        <Modal.Icon className="bg-success-soft text-success-soft-foreground">
          <CircleCheck className="size-5" />
        </Modal.Icon>
        <Modal.Heading>Transaksi selesai</Modal.Heading>
      </Modal.Header>

      {/* `overflow-visible`: bawaan `Modal.Body` menggulir (overflow-y auto,
          yang ikut memotong sumbu x) dan hanya menyisakan 3px — kurang untuk
          cincin fokus tombol yang menempel di tepi kolom, jadi cincin
          "Transaksi baru" terpotong tipis. Yang panjang di sini cuma struk,
          dan ia menggulir sendiri. Sama di dialog Pembayaran. */}
      <Modal.Body className="overflow-visible">
        <div className="grid min-w-0 gap-6 md:grid-cols-2">
          {/* Kiri: yang bukan isi struk — total dan kembalian yang harus
              diserahkan (dibaca pelanggan dari seberang meja — peran "Total
              keranjang" §3.4), hasil PPOB bila ada, nasib cetak otomatis,
              lalu tombolnya di dasar kolom. */}
          <div className="flex flex-col gap-4">
            {/* `change_amount` alone decides whether there is money to hand
                back: a split whose non-cash legs cover the total books no cash
                entry, yet the cash on the counter still comes back as change. */}
            <ChangeTotalPanel
              changeAmount={transaction.change_amount}
              totalAmount={transaction.total_amount}
            />

            {/* The same block as the result dialog on the PPOB page. */}
            {lines.map((line) => (
              <PpobLineResult
                key={line.id}
                checkingId={checkingId}
                line={line}
                onCheck={(itemId) => void check(itemId)}
              />
            ))}

            {/* Satu wilayah `status` yang selalu ada, supaya pembaca layar
                mengumumkan setiap perubahan nasib cetak otomatis dan PPOB. */}
            <div aria-live="polite" className="flex flex-col gap-2" role="status">
              {ppobInFlight && autoPrint && (
                <p className="flex items-center gap-2">
                  <Spinner color="current" size="sm" />
                  {id.ppobFulfillment.cartPpobInFlight}
                </p>
              )}
              {ppobUncertain && (
                <p className="flex items-center gap-2 font-medium text-warning">
                  <Clock aria-hidden="true" className="size-4 shrink-0" />
                  {id.ppobFulfillment.cartPpobTokenLater}
                </p>
              )}
              <AutoPrintStatus state={autoPrintState} />
            </div>

            <div className="mt-auto flex flex-col gap-2">
              <Button ref={copyButtonRef} fullWidth variant="tertiary" onPress={handleCopy}>
                <Copy />
                Salin struk
                <Kbd aria-hidden="true">
                  <Kbd.Content>C</Kbd.Content>
                </Kbd>
              </Button>
              <PendingButton
                ref={printButtonRef}
                fullWidth
                isPending={isPrinting}
                variant="tertiary"
                onPress={handlePrint}
              >
                <Printer />
                Cetak struk
                <Kbd aria-hidden="true">
                  <Kbd.Content>Enter</Kbd.Content>
                </Kbd>
              </PendingButton>
              <Button
                autoFocus
                className="min-h-12 text-lg"
                fullWidth
                size="lg"
                onPress={onNewTransaction}
              >
                Transaksi baru
                {/* Di tombol primary teks abu-abu Kbd tenggelam di biru; ikut warna teks tombolnya. */}
                <Kbd aria-hidden="true" className="text-accent-foreground" variant="light">
                  <Kbd.Content>Esc</Kbd.Content>
                </Kbd>
              </Button>
            </div>
          </div>

          {/* Kanan: struk panjang menggulir di dalam kertasnya. */}
          <ReceiptPreview
            className="max-h-[60vh]"
            paperWidth={paperWidth}
            transactionId={transaction.id}
          />
        </div>
      </Modal.Body>
    </>
  )
}

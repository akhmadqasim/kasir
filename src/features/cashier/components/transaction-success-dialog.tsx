import { useEffect, useRef, useState } from "react"
import { Button, Kbd, Modal, Spinner } from "@heroui/react"
import { Printer } from "lucide-react"

import { PendingButton } from "@/components/pending-button"
import { StatusBadge } from "@/components/status-badge"
import { ReceiptPreview } from "@/features/receipt"
import { SendWhatsappButton } from "@/features/whatsapp"
import { isPpobInFlight, ppobStatusConfig } from "@/features/transactions/ppob-status"
import { id } from "@/i18n/id"
import { errorMessage } from "@/lib/api/client"
import { printReceipt } from "@/lib/api/printers"
import { toast } from "@/lib/toast"
import { formatRupiah } from "../utils"
import type { TransactionResult } from "../types"

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

type AutoPrintState =
  | { status: "idle" }
  | { status: "printing" }
  | { status: "printed" }
  | { status: "failed"; message: string }

/**
 * Penjualan sudah tercatat; dialog ini hanya menampilkan hasilnya dari jawaban
 * checkout — tidak ada permintaan ke server saat terbuka, kecuali ke printer.
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
      <Modal.Container size="md">
        <Modal.Dialog aria-label="Transaksi selesai">
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
  const [isPrinting, setIsPrinting] = useState(false)
  const [autoPrintState, setAutoPrintState] = useState<AutoPrintState>({ status: "idle" })
  // Satu kali per struk, juga saat StrictMode menjalankan efeknya dua kali.
  const autoPrintStartedRef = useRef(false)
  // Umur komponen, bukan umur satu jalannya efek: StrictMode menjalankan
  // efek → cleanup → efek lagi, dan flag `cancelled` di closure jalan pertama
  // membuat cetak yang sudah dilepas tidak pernah melaporkan hasilnya.
  const unmountedRef = useRef(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const { transaction } = result

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      // Timer yang tidak dibatalkan akan menghapus keranjang pelanggan berikutnya
      clearTimeout(closeTimerRef.current)
    }
  }, [])

  // Cetak otomatis dimulai begitu dialog terbuka dan pengaturannya diketahui.
  // Tidak ada `await` sebelum dialog bisa dipakai: permintaan cetaknya
  // dilepas, dan hasilnya hanya mengubah satu baris keterangan.
  useEffect(() => {
    if (!autoPrint || autoPrintStartedRef.current) return
    autoPrintStartedRef.current = true
    setAutoPrintState({ status: "printing" })

    printReceipt(transaction.id).then(
      () => {
        if (unmountedRef.current) return
        setAutoPrintState({ status: "printed" })
        closeTimerRef.current = setTimeout(onNewTransaction, AUTO_CLOSE_DELAY_MS)
      },
      (error: unknown) => {
        if (unmountedRef.current) return
        setAutoPrintState({ status: "failed", message: errorMessage(error) })
      },
    )
  }, [autoPrint, onNewTransaction, transaction.id])

  // `change_amount` alone decides whether there is money to hand back.
  //
  // A split whose non-cash legs already cover the total drops its cash leg: the
  // sale is recorded as that single method with no cash entry at all, while the
  // cash the customer put on the counter comes straight back as change. Gating
  // this on "a cash entry exists" hid the whole amount from the cashier.
  const changeAmount = transaction.change_amount
  const ppobItems = result.items.filter((item) => item.service_type)

  const handlePrint = async () => {
    if (isPrinting) return
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

  // Enter mencetak, dari mana pun fokusnya di dialog ini — tanpa harus
  // mencari tombolnya dulu — dan Esc (bawaan Modal) membuka transaksi baru.
  // Fase capture supaya tombol yang kebetulan sedang fokus tidak ikut ditekan.
  const printRef = useRef(handlePrint)
  printRef.current = handlePrint
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof HTMLTextAreaElement) return
      event.preventDefault()
      event.stopPropagation()
      void printRef.current()
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [])

  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header>
        <Modal.Heading>Transaksi selesai</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        {/* Struknya sendiri sudah memuat total, metode, nomor transaksi dan
            rinciannya — tidak diulang di atasnya. Yang ditambahkan hanya apa
            yang bukan isi struk: kembalian yang harus diserahkan (dibaca
            pelanggan dari seberang meja — peran "Total keranjang" §3.4),
            status PPOB yang masih berjalan, dan nasib cetak otomatis. */}
        <div className="flex flex-col gap-4">
          {changeAmount > 0 && (
            <div>
              <p className="text-3xl font-semibold tracking-tight tabular-nums text-success">
                {formatRupiah(changeAmount)}
              </p>
              <p>
                {id.cashier.change} dari {formatRupiah(transaction.payment_amount)}
              </p>
            </div>
          )}

          {ppobItems.length > 0 && (
            <ul className="flex flex-col gap-1">
              {ppobItems.map((item) => {
                const status = ppobStatusConfig(item.ppob_status)
                return (
                  <li key={item.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-foreground">{item.product_name}</span>
                    {status && (
                      <StatusBadge size="sm" status={status.variant}>
                        {isPpobInFlight(item.ppob_status) && (
                          <Spinner className="size-3" color="current" size="sm" />
                        )}
                        {status.label}
                      </StatusBadge>
                    )}
                  </li>
                )
              })}
              <li>PPOB diproses di latar belakang; cek statusnya di Riwayat.</li>
            </ul>
          )}

          {autoPrintState.status === "printing" && (
            <p className="flex items-center gap-2">
              <Spinner color="current" size="sm" />
              Struk sedang dicetak otomatis…
            </p>
          )}
          {autoPrintState.status === "printed" && <p>Struk otomatis dicetak.</p>}
          {autoPrintState.status === "failed" && (
            <p className="text-danger">
              Struk gagal dicetak otomatis: {autoPrintState.message}. Gunakan tombol "Cetak
              struk".
            </p>
          )}

          <ReceiptPreview paperWidth={paperWidth} transactionId={transaction.id} />
        </div>
      </Modal.Body>

      <Modal.Footer>
        <PendingButton isPending={isPrinting} variant="tertiary" onPress={handlePrint}>
          <Printer />
          Cetak struk
          <Kbd aria-hidden="true">
            <Kbd.Abbr keyValue="enter" />
          </Kbd>
        </PendingButton>
        <SendWhatsappButton transactionId={transaction.id} />
        <Button autoFocus onPress={onNewTransaction}>
          Transaksi baru
          <Kbd aria-hidden="true" variant="light">
            <Kbd.Abbr keyValue="escape" />
          </Kbd>
        </Button>
      </Modal.Footer>
    </>
  )
}

import { useEffect, useRef, useState } from "react"
import { Button, Kbd, Modal, Spinner } from "@heroui/react"
import { Printer } from "lucide-react"

import { InfoPanel } from "@/components/info-panel"
import { PendingButton } from "@/components/pending-button"
import { StatusBadge } from "@/components/status-badge"
import { ReceiptPreview } from "@/features/receipt"
import { isPpobInFlight, ppobStatusConfig } from "@/features/transactions/ppob-status"
import { id } from "@/i18n/id"
import { errorMessage } from "@/lib/api/client"
import { printReceipt } from "@/lib/api/printers"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
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
        <div className="grid min-w-0 gap-6 md:grid-cols-2">
          {/* Kiri: yang bukan isi struk — total dan kembalian yang harus
              diserahkan (dibaca pelanggan dari seberang meja — peran "Total
              keranjang" §3.4), status PPOB yang masih berjalan, nasib cetak
              otomatis, lalu kedua tombolnya di dasar kolom. */}
          <div className="flex flex-col gap-4">
            {/* Kembalian di paling atas: itu yang diserahkan sekarang dan
                dibaca pelanggan dari seberang meja; total tinggal pengingat. */}
            <InfoPanel className="flex flex-col gap-3">
              {/* Selalu ada, juga "Rp 0" saat uangnya pas: baris yang
                  kadang muncul kadang tidak membuat kasir mencari-cari. */}
              <div className="flex items-start justify-between gap-4">
                <p className="text-muted">{id.cashier.change}</p>
                <p
                  className={cn(
                    "text-3xl font-semibold tracking-tight tabular-nums",
                    changeAmount > 0 ? "text-success" : "text-foreground",
                  )}
                >
                  {formatRupiah(changeAmount)}
                </p>
              </div>
              <div className="flex items-start justify-between gap-4">
                <p className="text-muted">Total</p>
                <p className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                  {formatRupiah(transaction.total_amount)}
                </p>
              </div>
            </InfoPanel>

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

            <div className="mt-auto flex flex-col gap-2">
              <PendingButton
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

import { useEffect, useRef, useState } from "react"
import { Button, Kbd, Modal, Spinner } from "@heroui/react"
import { Printer } from "lucide-react"

import { InfoPanel } from "@/components/info-panel"
import { PendingButton } from "@/components/pending-button"
import { StatusBadge } from "@/components/status-badge"
import { SummaryList } from "@/components/summary-list"
import type { TransactionResult } from "@/features/cashier/types"
import { isPpobInFlight, ppobStatusConfig } from "@/features/transactions/ppob-status"
import type { TransactionDetail, TransactionItem } from "@/features/transactions/types"
import { useApiQuery } from "@/hooks/use-api"
import { id } from "@/i18n/id"
import { errorMessage } from "@/lib/api/client"
import { printReceipt } from "@/lib/api/printers"
import { queryKeys } from "@/lib/api/query-keys"
import { getTransactionDetail } from "@/lib/api/transactions"
import { flashPress } from "@/lib/flash-press"
import { formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"

/** How often to ask whether the provider has answered yet. */
const POLL_MS = 1500

interface PpobResultDialogProps {
  open: boolean
  result: TransactionResult | null
  /** `undefined` while the printer settings are still loading. */
  autoPrint: boolean | undefined
  onDone: () => void
}

type AutoPrintState =
  | { status: "idle" }
  | { status: "printing" }
  | { status: "printed" }
  | { status: "failed"; message: string }

function ppobLine(items: TransactionItem[] | undefined): TransactionItem | undefined {
  return items?.find((item) => item.service_type)
}

/**
 * The purchase is paid; this is what happened to it upstream.
 *
 * Checkout answers before the provider does — the line comes back `pending`
 * and a background task chases it — so the detail is polled until the line is
 * final. What the customer is waiting for is on it: the token or serial
 * number, which the struk then carries.
 */
export function PpobResultDialog({ open, result, autoPrint, onDone }: PpobResultDialogProps) {
  if (!result) return null

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={() => onDone()}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label="Transaksi PPOB selesai">
          {/* `key` rebuilds the polling and the auto-print for the next purchase. */}
          <ResultContent
            key={result.transaction.id}
            result={result}
            autoPrint={autoPrint}
            onDone={onDone}
          />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

interface ResultContentProps extends Omit<PpobResultDialogProps, "open" | "result"> {
  result: TransactionResult
}

function ResultContent({ result, autoPrint, onDone }: ResultContentProps) {
  const { transaction } = result
  const [isPrinting, setIsPrinting] = useState(false)
  const [autoPrintState, setAutoPrintState] = useState<AutoPrintState>({ status: "idle" })
  // Once per struk, also when StrictMode runs the effect twice.
  const autoPrintStartedRef = useRef(false)
  const unmountedRef = useRef(false)

  const detail = useApiQuery<TransactionDetail>(
    queryKeys.transactions.detail(transaction.id),
    () => getTransactionDetail(transaction.id),
    {
      // Keep asking while the provider call is in flight; stop the moment the
      // line is final. Before the first answer the checkout result already
      // says `pending`, so that counts as in flight too.
      refetchInterval: (query) =>
        isPpobInFlight(ppobLine(query.state.data?.items)?.ppob_status ?? "pending")
          ? POLL_MS
          : false,
    },
  )

  const line = ppobLine(detail.data?.items) ?? ppobLine(result.items)
  const status = line?.ppob_status ?? "pending"
  const statusConfig = ppobStatusConfig(status)
  const inFlight = isPpobInFlight(status)
  const changeAmount = transaction.change_amount ?? 0

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

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

  // Auto-print waits for the provider: the struk printed before the token
  // arrived would be a struk without the one thing the customer came for.
  useEffect(() => {
    if (!autoPrint || inFlight || autoPrintStartedRef.current) return
    autoPrintStartedRef.current = true
    setAutoPrintState({ status: "printing" })
    printReceipt(transaction.id).then(
      () => {
        if (unmountedRef.current) return
        setAutoPrintState({ status: "printed" })
      },
      (error: unknown) => {
        if (unmountedRef.current) return
        setAutoPrintState({ status: "failed", message: errorMessage(error) })
      },
    )
  }, [autoPrint, inFlight, transaction.id])

  // Enter prints from anywhere in the dialog; Esc (Modal's own) is "Selesai".
  // Capture phase, so a button that happens to have focus is not pressed too.
  const printRef = useRef(handlePrint)
  printRef.current = handlePrint
  const printButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key !== "Enter") return
      event.preventDefault()
      event.stopPropagation()
      flashPress(printButtonRef.current)
      void printRef.current()
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [])

  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header>
        <Modal.Heading>Transaksi PPOB selesai</Modal.Heading>
      </Modal.Header>
      <Modal.Body className="overflow-visible">
        {/* Kembalian di atas: itu yang diserahkan sekarang; total tinggal pengingat. */}
        <InfoPanel className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <p className="text-muted">{id.cashier.change}</p>
            <p className="text-3xl font-semibold tracking-tight tabular-nums text-success">
              {formatRupiah(changeAmount)}
            </p>
          </div>
          <div className="flex items-start justify-between gap-4">
            <p className="text-muted">Total</p>
            <p className="text-base font-medium tabular-nums text-muted">
              {formatRupiah(transaction.total_amount)}
            </p>
          </div>
        </InfoPanel>

        {line && (
          <div className="flex items-center justify-between gap-4">
            <p className="min-w-0 truncate text-foreground">{line.product_name}</p>
            <span className="flex shrink-0 items-center gap-2">
              {inFlight && <Spinner color="current" size="sm" />}
              {statusConfig && (
                <StatusBadge status={statusConfig.variant}>{statusConfig.label}</StatusBadge>
              )}
            </span>
          </div>
        )}

        {line?.ppob_serial_number && (
          <SummaryList
            layout="grid"
            items={[{ label: "No. Seri / Token", value: line.ppob_serial_number, tone: "mono" }]}
          />
        )}

        {status === "failed" && (
          <p className="text-danger">
            {line?.ppob_message?.trim() || "Provider menolak transaksinya."} Coba ulang dari
            Riwayat.
          </p>
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
            Struk gagal dicetak otomatis: {autoPrintState.message}. Gunakan tombol "Cetak struk".
          </p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <PendingButton
          ref={printButtonRef}
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
        <Button autoFocus onPress={onDone}>
          Selesai
          <Kbd aria-hidden="true" className="text-accent-foreground" variant="light">
            <Kbd.Content>Esc</Kbd.Content>
          </Kbd>
        </Button>
      </Modal.Footer>
    </>
  )
}

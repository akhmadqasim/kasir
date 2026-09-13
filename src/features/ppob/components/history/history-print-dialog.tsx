import { useState } from "react"
import { Button, Label, Modal, NumberField, Skeleton } from "@heroui/react"
import { Printer } from "lucide-react"

import { InfoPanel } from "@/components/info-panel"
import { NoData } from "@/components/no-data"
import { PendingButton } from "@/components/pending-button"
import { SummaryList, type SummaryItem } from "@/components/summary-list"
import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import { useDebounce } from "@/hooks/use-debounce"
import { id as t } from "@/i18n/id"
import { getPpobHistoryReceipt, printPpobHistoryReceipt } from "@/lib/api/ppob"
import { queryKeys } from "@/lib/api/query-keys"
import { getPpobMarkup } from "@/lib/api/settings"
import { formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import type { HistoryPaymentItem, PpobReceiptLine } from "../../types"
import type { PpobMarkup } from "../../types/auth"
import { buildDescription, getDefaultSellPrice, getProviderTotal } from "./history-utils"

/** The preview waits this long after the last keystroke before asking the server. */
const PREVIEW_DEBOUNCE_MS = 300

function ReceiptPreview({ lines }: { lines: PpobReceiptLine[] }) {
  return (
    // `pre`, not a list: the server padded every line to the paper's columns,
    // and only a preformatted block keeps that alignment on screen.
    <pre
      aria-label={t.ppob.receiptPreview}
      className="overflow-x-auto font-mono text-xs leading-5 text-foreground"
    >
      {lines.map((line, index) => (
        <div
          // Lines repeat (blank rules, spacers), so the index is the identity.
          key={index}
          className={cn(line.bold && "font-semibold", line.size === "double" && "text-base")}
        >
          {line.text || " "}
        </div>
      ))}
    </pre>
  )
}

interface HistoryPrintDialogProps {
  item: HistoryPaymentItem | null
  onClose: () => void
}

/**
 * The Mitra app's "Ringkasan Transaksi": what the outlet paid, a "Harga Jual"
 * it can change, the profit that leaves, and "Cetak Struk".
 *
 * Stays mounted while closed so the price chosen for a transaction is still
 * there when its dialog is opened again — a reprint of the same slip should
 * not start from the default a second time. Nothing is persisted: the price
 * lives on the struk, not in the books.
 */
export function HistoryPrintDialog({ item, onClose }: HistoryPrintDialogProps) {
  const trxId = item?.trxId ?? null
  const providerTotal = item ? getProviderTotal(item) : null

  const markupQuery = useApiQuery<PpobMarkup>(queryKeys.ppob.markup, getPpobMarkup, {
    staleTime: 5 * 60_000,
    retry: false,
  })
  const markup = markupQuery.data

  // The last price used per transaction. `null` is a cleared field.
  const [prices, setPrices] = useState<Record<string, number | null>>({})
  const defaultPrice =
    item && providerTotal != null ? getDefaultSellPrice(item, providerTotal, markup) : null
  const sellPrice = trxId != null && trxId in prices ? prices[trxId]! : defaultPrice
  const setSellPrice = (value: number | null) => {
    if (trxId != null) setPrices((previous) => ({ ...previous, [trxId]: value }))
  }

  const hasPrice = sellPrice != null && Number.isFinite(sellPrice) && sellPrice >= 0
  const profit = hasPrice && providerTotal != null ? sellPrice - providerTotal : null

  const previewPrice = useDebounce(hasPrice ? sellPrice : null, PREVIEW_DEBOUNCE_MS)
  // Not before the markup has answered (or failed): the default price moves
  // once it does, and a preview at the wrong price is a wasted round-trip.
  const previewEnabled = trxId != null && previewPrice != null && !markupQuery.isPending
  const preview = useApiQuery<PpobReceiptLine[]>(
    queryKeys.ppob.historyReceipt(trxId ?? "", previewPrice ?? -1),
    () => getPpobHistoryReceipt(trxId ?? "", previewPrice ?? 0),
    {
      enabled: previewEnabled,
      refetchOnWindowFocus: false,
      retry: false,
    },
  )

  const print = useApiMutation(() => printPpobHistoryReceipt(trxId ?? "", sellPrice ?? 0), {
    onSuccess: () => toast.success(t.ppob.receiptPrinted),
    onError: (error) => toast.error(`${t.ppob.receiptPrintFailed}: ${error.message}`),
  })

  const summary: SummaryItem[] = [
    ...(item ? [{ label: "Deskripsi", value: buildDescription(item) }] : []),
    { label: t.ppob.basePrice, value: providerTotal != null ? formatRupiah(providerTotal) : "-" },
  ]
  const profitItem: SummaryItem = {
    label: t.ppob.profit,
    value: profit != null ? `${profit >= 0 ? "+" : ""}${formatRupiah(profit)}` : "-",
    tone: profit == null ? "default" : profit >= 0 ? "success" : "danger",
  }

  return (
    <Modal.Backdrop isOpen={!!item} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label={t.ppob.summaryTitle}>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-default text-foreground">
              <Printer className="size-5" />
            </Modal.Icon>
            <Modal.Heading>{t.ppob.summaryTitle}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <p>{t.ppob.summaryHint}</p>

            <SummaryList items={summary} layout="row" />

            <NumberField
              fullWidth
              // Grouping is off on purpose: React Aria parses with the runtime
              // locale and the app ships no I18nProvider, so a grouped "25.000"
              // would read as 25 on an en-US webview.
              formatOptions={{ useGrouping: false, maximumFractionDigits: 0 }}
              minValue={0}
              value={sellPrice ?? Number.NaN}
              variant="secondary"
              onChange={(value) =>
                setSellPrice(value === undefined || Number.isNaN(value) ? null : value)
              }
            >
              <Label>{t.ppob.price}</Label>
              {/* No +/- buttons: a rupiah price is typed, and any step that
                  made the buttons useful would snap a typed 74.729 to it. */}
              <NumberField.Group>
                <NumberField.Input className="text-right tabular-nums" />
              </NumberField.Group>
            </NumberField>

            <SummaryList items={[profitItem]} layout="row" />

            <InfoPanel>
              {preview.isError ? (
                <NoData title={t.ppob.receiptPreviewFailed} tone="danger">
                  {preview.error.message}
                </NoData>
              ) : preview.data && previewEnabled && !preview.isFetching ? (
                <ReceiptPreview lines={preview.data} />
              ) : (
                <div aria-busy="true" className="flex flex-col gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                  ))}
                </div>
              )}
            </InfoPanel>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              {t.common.close}
            </Button>
            <PendingButton
              isDisabled={!hasPrice || preview.isError}
              isPending={print.isPending}
              onPress={() => print.mutate()}
            >
              {t.transactions.printReceipt}
            </PendingButton>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

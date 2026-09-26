import { useState } from "react"
import { Button, Modal, Separator, Table } from "@heroui/react"

import { NoData } from "@/components/no-data"
import { SummaryList, type SummaryItem } from "@/components/summary-list"
import { id as t } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import type { HistoryPaymentItem } from "../../types"
import { PendingButton } from "@/components/pending-button"
import { HistoryPrintFields } from "./history-print"
import { useHistoryPrint } from "./use-history-print"
import { VendorStatusBadge } from "./vendor-status-badge"
import {
  detectServiceType,
  normalizeStatus,
  formatDateTime,
  buildDescription,
  getNominal,
  getProviderTotal,
} from "./history-utils"

/** Baris rincian hanya digambar bila vendor memang mengisi nilainya. */
function detailItem(
  label: string,
  value: string | null | undefined,
  tone?: SummaryItem["tone"],
): SummaryItem[] {
  if (!value || value === "-") return []
  return [{ label, value, tone }]
}

export function TransactionDetailDialog({
  item,
  isOpen = item !== null,
  onClose,
}: {
  item: HistoryPaymentItem | null
  /**
   * Separate from `item` so the table can keep the last row on screen while
   * the dialog animates out — clearing `item` on close emptied the body and
   * the header icon mid-animation, a visible flicker on every close.
   */
  isOpen?: boolean
  onClose: () => void
}) {
  const service = item ? detectServiceType(item) : null
  // Only a settled transaction the server can look up again has a struk
  // worth printing; it refuses the others, so no fee field for them.
  const printable = item?.trxId != null && normalizeStatus(item.status) === "sukses"
  // The struk is the point of opening the detail; once it is out, so is the dialog.
  const printing = useHistoryPrint(printable ? item : null, onClose)
  const providerTotal = item ? getProviderTotal(item) : null
  const referenceItems: SummaryItem[] = item
    ? [
        ...detailItem("No. Transaksi", item.trxId, "mono"),
        ...detailItem("No. Pelanggan", item.customerNo, "mono"),
        ...detailItem("No. Referensi", item.noRef, "mono"),
        ...detailItem("Kode Bayar", item.paymentCode, "mono"),
        ...detailItem("Token/SN", item.tokenNumber ?? item.serialNumber, "mono"),
        ...detailItem("Provider", item.provider),
        ...detailItem("Denom", item.denom),
        ...detailItem("Keterangan", item.igrDesc),
      ]
    : []

  // What the outlet paid Mitra, and only that. The row carries no sell
  // price of ours — the history is Mitra's ledger — so "Harga Jual" and
  // "Profit" are not invented from the admin fee; the fee field below is
  // where the shop's own price is decided.
  const priceItems: SummaryItem[] = item
    ? [
        ...(item.basePrice != null ? detailItem("Harga Dasar", formatRupiah(item.basePrice)) : []),
        ...(item.adminFee != null && item.adminFee > 0
          ? detailItem("Biaya Admin", formatRupiah(item.adminFee))
          : []),
        ...(providerTotal != null
          ? detailItem("Harga Modal", formatRupiah(providerTotal), "strong")
          : []),
      ]
    : []

  return (
    <Modal.Backdrop isOpen={isOpen && !!item} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label="Detail Transaksi">
          <Modal.CloseTrigger />
          <Modal.Header>
            {/* Ikon layanan di tempat `Modal.Icon`: cakram tipis `--service-*`/15 dengan
                glyph berwarna penuh, sama seperti tile PPOB. */}
            {service ? (
              <Modal.Icon className={`${service.tint} ${service.text}`}>
                <service.icon className="size-5" />
              </Modal.Icon>
            ) : null}
            <Modal.Heading>Detail Transaksi</Modal.Heading>
          </Modal.Header>
          {item && service && (
            <Modal.Body>
              <div className="flex items-center justify-between gap-2">
                <p>
                  <span className="font-medium text-foreground">{service.label}</span>
                  <span aria-hidden="true"> · </span>
                  {formatDateTime(item.createdAt)}
                </p>
                <VendorStatusBadge size="sm" status={item.status} />
              </div>

              <SummaryList
                items={[{ label: "Deskripsi", value: buildDescription(item) }, ...referenceItems]}
                layout="grid"
              />

              <Separator />

              <SummaryList items={priceItems} layout="grid" />

              {printable && (
                <>
                  <Separator />
                  <HistoryPrintFields control={printing} />
                </>
              )}
            </Modal.Body>
          )}
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              {t.common.close}
            </Button>
            {printable && (
              <PendingButton
                isDisabled={printing.sellPrice == null}
                isPending={printing.print.isPending}
                onPress={() => printing.print.mutate()}
              >
                {t.transactions.printReceipt}
              </PendingButton>
            )}
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

interface HistoryTableProps {
  items: HistoryPaymentItem[]
}

export function HistoryTable({ items }: HistoryTableProps) {
  const [selectedItem, setSelectedItem] = useState<HistoryPaymentItem | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  return (
    <>
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label="Riwayat transaksi PPOB">
            <Table.Header>
              <Table.Column isRowHeader id="service">
                Layanan
              </Table.Column>
              <Table.Column id="date">Tanggal</Table.Column>
              <Table.Column id="description">Deskripsi</Table.Column>
              <Table.Column className="text-right" id="amount">
                Nominal
              </Table.Column>
              <Table.Column id="status">Status</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => <NoData />}>
              {items.map((item, idx) => {
                const rowId = item.trxId ?? `item-${idx}`
                const service = detectServiceType(item)
                const nominal = getNominal(item)

                return (
                  <Table.Row
                    key={rowId}
                    className="cursor-pointer"
                    id={rowId}
                    textValue={service.label}
                    onAction={() => {
                      setSelectedItem(item)
                      setIsDetailOpen(true)
                    }}
                  >
                    <Table.Cell>
                      {/* Ikon berwarna token `--service-*` (DESIGN.md §3.2) di
                          samping teksnya — bukan bulatan latar per baris. */}
                      <div className="flex items-center gap-2">
                        <service.icon aria-hidden="true" className={`size-4 ${service.text}`} />
                        <span>{service.label}</span>
                      </div>
                    </Table.Cell>
                    <Table.Cell className="whitespace-nowrap text-muted tabular-nums">
                      {formatDateTime(item.createdAt)}
                    </Table.Cell>
                    <Table.Cell className="max-w-64 truncate">{buildDescription(item)}</Table.Cell>
                    <Table.Cell className="text-right font-medium whitespace-nowrap tabular-nums">
                      {nominal != null ? formatRupiah(nominal) : "-"}
                    </Table.Cell>
                    <Table.Cell>
                      <VendorStatusBadge size="sm" status={item.status} />
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <TransactionDetailDialog
        isOpen={isDetailOpen}
        item={selectedItem}
        onClose={() => setIsDetailOpen(false)}
      />
    </>
  )
}

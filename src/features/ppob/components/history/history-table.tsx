import { useState } from "react"
import { Button, Modal, Separator, Table } from "@heroui/react"

import { NoData } from "@/components/no-data"
import { StatusBadge } from "@/components/status-badge"
import { SummaryList, type SummaryItem } from "@/components/summary-list"
import { id as t } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import type { HistoryPaymentItem } from "../../types"
import { HistoryPrintDialog } from "./history-print-dialog"
import {
  detectServiceType,
  normalizeStatus,
  formatDateTime,
  buildDescription,
  getNominal,
} from "./history-utils"

function PpobStatusBadge({ status }: { status: string | null }) {
  switch (normalizeStatus(status)) {
    case "sukses":
      return (
        <StatusBadge status="success" size="sm">
          Sukses
        </StatusBadge>
      )
    case "gagal":
      return (
        <StatusBadge status="error" size="sm">
          Gagal
        </StatusBadge>
      )
    case "proses":
      return (
        <StatusBadge status="warning" size="sm">
          Proses
        </StatusBadge>
      )
    default:
      return (
        <StatusBadge status="neutral" size="sm">
          {status ?? "-"}
        </StatusBadge>
      )
  }
}

/** Baris rincian hanya digambar bila vendor memang mengisi nilainya. */
function detailItem(
  label: string,
  value: string | null | undefined,
  tone?: SummaryItem["tone"],
): SummaryItem[] {
  if (!value || value === "-") return []
  return [{ label, value, tone }]
}

function TransactionDetailDialog({
  item,
  onClose,
  onPrint,
}: {
  item: HistoryPaymentItem | null
  onClose: () => void
  /** Open the "Ringkasan Transaksi" dialog for this row. */
  onPrint: (item: HistoryPaymentItem) => void
}) {
  const service = item ? detectServiceType(item) : null
  const nominal = item ? getNominal(item) : null
  const profit =
    item && item.amount != null && item.basePrice != null ? item.amount - item.basePrice : null

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

  const priceItems: SummaryItem[] = item
    ? [
        ...(item.basePrice != null ? detailItem("Harga Modal", formatRupiah(item.basePrice)) : []),
        ...(nominal != null ? detailItem("Harga Jual", formatRupiah(nominal), "strong") : []),
        ...(item.adminFee != null && item.adminFee > 0
          ? detailItem("Biaya Admin", formatRupiah(item.adminFee))
          : []),
        ...(profit != null
          ? detailItem(
              "Profit",
              `${profit >= 0 ? "+" : ""}${formatRupiah(profit)}`,
              profit >= 0 ? "success" : "danger",
            )
          : []),
      ]
    : []

  return (
    <Modal.Backdrop isOpen={!!item} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label="Detail Transaksi">
          <Modal.CloseTrigger />
          <Modal.Header>
            {/* Ikon layanan di tempat `Modal.Icon`, warnanya dari token `--service-*`. */}
            {service ? (
              <Modal.Icon className={`${service.bg} ${service.text}`}>
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
                <PpobStatusBadge status={item.status} />
              </div>

              <SummaryList
                items={[{ label: "Deskripsi", value: buildDescription(item) }, ...referenceItems]}
                layout="grid"
              />

              <Separator />

              <SummaryList items={priceItems} layout="grid" />
            </Modal.Body>
          )}
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              {t.common.close}
            </Button>
            {/* Only a settled transaction has a struk worth printing; the
                server refuses the others, so the button is not offered. */}
            {item && normalizeStatus(item.status) === "sukses" ? (
              <Button onPress={() => onPrint(item)}>{t.transactions.printReceipt}</Button>
            ) : null}
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
  const [printItem, setPrintItem] = useState<HistoryPaymentItem | null>(null)

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
                    id={rowId}
                    textValue={service.label}
                    onAction={() => setSelectedItem(item)}
                  >
                    <Table.Cell>
                      {/* Ikon berwarna token `--service-*` (DESIGN.md §3.2) di
                          samping teksnya — bukan bulatan latar per baris. */}
                      <div className="flex items-center gap-2">
                        <service.icon aria-hidden="true" className={`size-4 ${service.text}`} />
                        <span>{service.label}</span>
                      </div>
                    </Table.Cell>
                    <Table.Cell className="whitespace-nowrap text-muted">
                      {formatDateTime(item.createdAt)}
                    </Table.Cell>
                    <Table.Cell className="max-w-64 truncate">{buildDescription(item)}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap text-right font-medium tabular-nums">
                      {nominal != null ? formatRupiah(nominal) : "-"}
                    </Table.Cell>
                    <Table.Cell>
                      <PpobStatusBadge status={item.status} />
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <TransactionDetailDialog
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onPrint={(item) => {
          setSelectedItem(null)
          setPrintItem(item)
        }}
      />
      <HistoryPrintDialog item={printItem} onClose={() => setPrintItem(null)} />
    </>
  )
}

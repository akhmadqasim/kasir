import { useState } from "react"
import { Button, Modal, Separator, Table } from "@heroui/react"

import { NoData } from "@/components/no-data"
import { StatusBadge } from "@/components/status-badge"
import { SummaryList, type SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import type { HistoryPaymentItem } from "../../types"
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
}: {
  item: HistoryPaymentItem | null
  onClose: () => void
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
            <Modal.Heading>Detail Transaksi</Modal.Heading>
          </Modal.Header>
          {item && service && (
            <Modal.Body>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex size-10 shrink-0 items-center justify-center rounded-full ${service.bg}`}
                  >
                    <service.icon className={`size-5 ${service.text}`} />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{service.label}</p>
                    <p>{formatDateTime(item.createdAt)}</p>
                  </div>
                </div>
                <PpobStatusBadge status={item.status} />
              </div>

              <Separator />

              <div>
                <p>Deskripsi</p>
                <p className="font-medium text-foreground">{buildDescription(item)}</p>
              </div>

              <Separator />

              <SummaryList items={referenceItems} layout="grid" />

              <Separator />

              <SummaryList items={priceItems} layout="grid" />
            </Modal.Body>
          )}
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              Tutup
            </Button>
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
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`flex size-8 shrink-0 items-center justify-center rounded-full ${service.bg}`}
                        >
                          <service.icon className={`size-4 ${service.text}`} />
                        </div>
                        <span className="text-sm font-semibold">{service.label}</span>
                      </div>
                    </Table.Cell>
                    <Table.Cell className="whitespace-nowrap text-sm text-muted">
                      {formatDateTime(item.createdAt)}
                    </Table.Cell>
                    <Table.Cell className="text-sm">
                      <p className="truncate">{buildDescription(item)}</p>
                    </Table.Cell>
                    <Table.Cell className="whitespace-nowrap text-right font-semibold tabular-nums">
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

      <TransactionDetailDialog item={selectedItem} onClose={() => setSelectedItem(null)} />
    </>
  )
}

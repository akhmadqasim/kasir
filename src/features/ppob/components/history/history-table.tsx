import { useState } from "react"
import { Modal, Separator, Table } from "@heroui/react"

import { StatusBadge } from "@/components/status-badge"
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

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  if (!value || value === "-") return null
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
      <span className="text-xs text-muted">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  )
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

  return (
    <Modal.Backdrop isOpen={!!item} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label="Detail Transaksi">
          <Modal.Header>
            <Modal.Heading>Detail Transaksi</Modal.Heading>
            <Modal.CloseTrigger />
          </Modal.Header>
          {item && service && (
            <Modal.Body className="space-y-4">
              {/* Header: service info + status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${service.bg}`}
                  >
                    <service.icon className={`h-5 w-5 ${service.text}`} />
                  </div>
                  <div>
                    <p className="font-semibold">{service.label}</p>
                    <p className="text-sm text-muted">{formatDateTime(item.createdAt)}</p>
                  </div>
                </div>
                <PpobStatusBadge status={item.status} />
              </div>

              <Separator />

              <div className="text-sm">
                <p className="mb-1 text-muted">Deskripsi</p>
                <p className="font-medium">{buildDescription(item)}</p>
              </div>

              <Separator />

              <div className="space-y-1">
                <DetailRow label="No. Transaksi" value={item.trxId} mono />
                <DetailRow label="No. Pelanggan" value={item.customerNo} mono />
                <DetailRow label="No. Referensi" value={item.noRef} mono />
                <DetailRow label="Kode Bayar" value={item.paymentCode} mono />
                <DetailRow label="Token/SN" value={item.tokenNumber ?? item.serialNumber} mono />
                <DetailRow label="Provider" value={item.provider} />
                <DetailRow label="Denom" value={item.denom} />
                <DetailRow label="Keterangan" value={item.igrDesc} />
              </div>

              <Separator />

              <div className="space-y-1">
                {item.basePrice != null && (
                  <DetailRow label="Harga Modal" value={formatRupiah(item.basePrice)} />
                )}
                {nominal != null && (
                  <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
                    <span className="text-xs text-muted">Harga Jual</span>
                    <span className="font-semibold">{formatRupiah(nominal)}</span>
                  </div>
                )}
                {item.adminFee != null && item.adminFee > 0 && (
                  <DetailRow label="Biaya Admin" value={formatRupiah(item.adminFee)} />
                )}
                {profit != null && (
                  <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
                    <span className="text-xs text-muted">Profit</span>
                    <span
                      className={
                        profit >= 0 ? "font-semibold text-success" : "font-semibold text-danger"
                      }
                    >
                      {profit >= 0 ? "+" : ""}
                      {formatRupiah(profit)}
                    </span>
                  </div>
                )}
              </div>
            </Modal.Body>
          )}
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

  const renderEmptyState = () => (
    <p className="py-8 text-center text-muted">Tidak ada transaksi ditemukan</p>
  )

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
            <Table.Body renderEmptyState={renderEmptyState}>
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
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${service.bg}`}
                        >
                          <service.icon className={`h-4 w-4 ${service.text}`} />
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
                    <Table.Cell className="whitespace-nowrap text-right font-semibold">
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

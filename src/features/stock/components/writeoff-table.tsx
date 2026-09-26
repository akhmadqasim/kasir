import { ClipboardX } from "lucide-react"
import { Table } from "@heroui/react"

import { NoData } from "@/components/no-data"
import { TableSkeletonRows } from "@/components/table-skeleton-rows"
import { StatusBadge } from "@/components/status-badge"
import { id } from "@/i18n/id"
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format"
import { cn } from "@/lib/utils"
import { writeoffReasonLabel, writeoffStatusLabel, writeoffStatusVariant } from "../labels"
import { WriteoffActions } from "./writeoff-actions"
import type { WriteoffAction } from "./writeoff-confirm-dialog"
import type { StockWriteoff } from "../types"

const COLUMN_COUNT = 8

interface WriteoffTableProps {
  writeoffs: StockWriteoff[]
  /** Baris `Skeleton` menggantikan isi selama muatan pertama berjalan. */
  isLoading: boolean
  /** Isi yang tampil masih milik filter/halaman sebelumnya (`keepPreviousData`). */
  isRefreshing: boolean
  /** Ada filter aktif — keadaan kosongnya "tidak cocok", bukan "belum ada". */
  hasFilters: boolean
  isAdmin: boolean
  onAction: (action: WriteoffAction) => void
}

export function WriteoffTable({
  writeoffs,
  isLoading,
  isRefreshing,
  hasFilters,
  isAdmin,
  onAction,
}: WriteoffTableProps) {
  return (
    <Table
      aria-busy={isLoading || isRefreshing}
      className={cn("transition-opacity", isRefreshing && "opacity-60")}
      variant="secondary"
    >
      <Table.ScrollContainer>
        <Table.Content aria-label={id.nav.stock}>
          <Table.Header>
            {/* Tanggal menumpang di bawah nomor WO, bukan kolom sendiri: dengan
                sembilan kolom tabelnya lebih lebar dari layar 1024px — dan di
                1366px pun kolom Aksi terpotong di balik guliran samping. */}
            <Table.Column isRowHeader>No. WO</Table.Column>
            <Table.Column>Produk</Table.Column>
            <Table.Column>Kasir</Table.Column>
            <Table.Column className="text-right">Qty</Table.Column>
            <Table.Column>Alasan</Table.Column>
            <Table.Column className="text-right whitespace-nowrap">Nilai Kerugian</Table.Column>
            <Table.Column>Status</Table.Column>
            <Table.Column className="text-right">Aksi</Table.Column>
          </Table.Header>
          <Table.Body
            renderEmptyState={() =>
              hasFilters ? (
                <NoData icon={<ClipboardX />} title={id.noMatch.writeoffs}>
                  Coba ganti filter status atau alasan.
                </NoData>
              ) : (
                <NoData icon={<ClipboardX />} title={id.empty.writeoffs}>
                  {id.empty.writeoffsHint}
                </NoData>
              )
            }
          >
            {isLoading ? (
              <TableSkeletonRows columns={COLUMN_COUNT} rows={5} />
            ) : (
              writeoffs.map((wo) => (
                <Table.Row key={wo.id} id={wo.id} textValue={wo.writeoffNumber}>
                  <Table.Cell className="whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="font-mono">{wo.writeoffNumber}</span>
                      <span className="text-xs text-muted tabular-nums">
                        {formatDateTime(wo.createdAt)}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    {/* Lebarnya dibatasi supaya nama panjang terpotong, bukan
                        mendorong kolom Aksi keluar layar. */}
                    <div className="flex max-w-40 flex-col @5xl:max-w-xs">
                      <span className="truncate font-medium" title={wo.productName}>
                        {wo.productName}
                      </span>
                      {/* Catatan dan asal refund dulu tidak terlihat di
                            mana pun setelah write-off dibuat. */}
                      {(wo.notes || wo.refundId != null) && (
                        <span className="truncate text-xs text-muted" title={wo.notes ?? undefined}>
                          {[wo.refundId != null ? "Dari refund" : null, wo.notes]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-muted">{wo.cashierName}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {formatNumber(wo.quantity)}
                  </Table.Cell>
                  {/* Alasan adalah kategori, bukan status: teks polos
                        (DESIGN.md §5.4). */}
                  <Table.Cell>{writeoffReasonLabel(wo.reason)}</Table.Cell>
                  {/* Write-off yang ditolak tidak lagi dihitung sebagai
                        kerugian, jadi nilainya tidak merah; kolom status
                        di sebelahnya yang menyebut alasannya. */}
                  <Table.Cell
                    className={cn(
                      "text-right font-medium tabular-nums",
                      wo.status === "rejected" ? "text-muted line-through" : "text-danger",
                    )}
                  >
                    {formatRupiah(wo.lossValue)}
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge status={writeoffStatusVariant(wo.status)}>
                      {writeoffStatusLabel(wo.status)}
                    </StatusBadge>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <WriteoffActions writeoff={wo} isAdmin={isAdmin} onAction={onAction} />
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  )
}

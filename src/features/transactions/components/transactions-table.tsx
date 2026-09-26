import type { ReactNode } from "react"
import { Table } from "@heroui/react"

import { StatusBadge } from "@/components/status-badge"
import { TableSkeletonRows } from "@/components/table-skeleton-rows"
import { formatDateTime, formatRupiah } from "@/lib/format"
import { paymentMethodLabel, transactionStatusLabel, transactionStatusVariant } from "@/lib/labels"
import { id } from "@/i18n/id"
import type { TransactionListItem } from "../types"
import { TransactionRowActions } from "./transaction-row-actions"

const COLUMN_COUNT = 7

/**
 * Sel aksi yang menempel di kanan. Sel tabel `secondary` transparan, jadi sel
 * yang menempel butuh latar pekat seperti halaman — plus warna hover barisnya
 * sendiri, karena `bg-default/50` bawaan tembus pandang dan akan memperlihatkan
 * isi kolom yang tergulir di bawahnya.
 */
const STICKY_ACTIONS_CELL =
  "sticky right-0 bg-background ps-2 text-right [tr:hover>&]:bg-[color-mix(in_oklab,var(--default)_50%,var(--background))]"

/**
 * Keterangan baris: alasan hapus, catatan, dan pesan PPOB — masing-masing baris
 * sendiri. Pesan PPOB dulu juga digambar di bawah nomor struk, jadi transaksi
 * tanpa catatan menampilkannya dua kali; sekarang hanya di kolom ini.
 */
function transactionDescriptions(txn: TransactionListItem): string[] {
  const lines: string[] = []
  const deletedReason = txn.deleted_reason?.trim()
  const notes = txn.notes?.trim()
  const ppobMessage = txn.ppob_message?.trim()
  if (deletedReason) lines.push(`Alasan hapus: ${deletedReason}`)
  if (notes) lines.push(notes)
  if (ppobMessage) lines.push(ppobMessage)
  return lines
}

interface TransactionsTableProps {
  transactions: TransactionListItem[]
  /** First load: skeleton rows instead of the (still empty) list. */
  isLoading: boolean
  /** Error, no match for the filters, or simply nothing sold yet. */
  renderEmptyState: () => ReactNode
  onOpenDetail: (txn: TransactionListItem) => void
}

export function TransactionsTable({
  transactions,
  isLoading,
  renderEmptyState,
  onOpenDetail,
}: TransactionsTableProps) {
  return (
    // The table is its own scroller (both axes) so the header stays put and the
    // horizontal scrollbar sits at the bottom of the screen, not below the last row.
    <Table className="h-full grid-rows-[minmax(0,1fr)]" variant="secondary">
      <Table.ScrollContainer className="overflow-auto">
        <Table.Content
          aria-label={id.transactions.title}
          className="tabular-nums [&_th]:whitespace-nowrap [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10"
        >
          <Table.Header>
            <Table.Column isRowHeader>{id.transactions.receiptNumber}</Table.Column>
            <Table.Column>
              {id.transactions.date} / {id.transactions.cashier}
            </Table.Column>
            <Table.Column>{id.transactions.paymentMethod}</Table.Column>
            <Table.Column>{id.transactions.description}</Table.Column>
            <Table.Column>{id.transactions.status}</Table.Column>
            <Table.Column className="text-right">{id.transactions.totalAmount}</Table.Column>
            {/* Aksi menempel di kanan: di 1024px tabelnya lebih lebar dari layar,
                dan tombol yang paling sering dipakai tidak boleh ikut tergulir keluar. */}
            <Table.Column className="right-0 w-24 ps-2 text-right">
              <span className="sr-only">Aksi</span>
            </Table.Column>
          </Table.Header>
          <Table.Body renderEmptyState={renderEmptyState}>
            {isLoading ? (
              <TableSkeletonRows columns={COLUMN_COUNT} rows={5} />
            ) : (
              transactions.map((txn) => {
                const isDeleted = txn.status === "deleted"
                const descriptions = transactionDescriptions(txn)
                return (
                  <Table.Row
                    key={txn.id}
                    id={txn.id}
                    // Redup lewat warna teks, bukan `opacity-50`: opasitas ikut
                    // menurunkan kontras lencana dan angka di bawah batas AA.
                    // Statusnya sendiri dibawa lencana "Dihapus".
                    className={isDeleted ? "[&>td]:text-muted" : undefined}
                    textValue={txn.receipt_number}
                    onAction={() => onOpenDetail(txn)}
                  >
                    <Table.Cell className="font-mono whitespace-nowrap">
                      {txn.receipt_number}
                    </Table.Cell>
                    {/* Kasir di bawah waktunya, bukan kolom sendiri: sembilan
                        kolom tidak muat di 1366px dengan sidebar terbuka, dan
                        tombol aksi di ujung kanan yang terpotong duluan. */}
                    <Table.Cell className="whitespace-nowrap">
                      <div className="flex flex-col">
                        <span>{formatDateTime(txn.created_at)}</span>
                        <span className="max-w-40 truncate text-xs text-muted">
                          {txn.cashier_name}
                        </span>
                      </div>
                    </Table.Cell>
                    {/* Teks, bukan `Chip`: lencana disimpan untuk kolom Status. */}
                    <Table.Cell>{paymentMethodLabel(txn.payment_method)}</Table.Cell>
                    <Table.Cell className="max-w-64 min-w-24 whitespace-normal">
                      {descriptions.length > 0 ? (
                        <div className="flex flex-col gap-0.5 text-muted">
                          {descriptions.map((line, index) => (
                            <p key={index} className="line-clamp-2 break-words" title={line}>
                              {line}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <span aria-hidden="true" className="text-muted">
                          —
                        </span>
                      )}
                    </Table.Cell>
                    {/* Lencana hanya untuk pengecualian — DESIGN.md §5.4. Sepuluh
                        lencana "Selesai" berjajar membuat "Refund Sebagian" atau
                        "Dihapus" tenggelam di antaranya. */}
                    <Table.Cell className="whitespace-nowrap">
                      {txn.status === "completed" ? (
                        <span className="text-muted">{transactionStatusLabel(txn.status)}</span>
                      ) : (
                        <StatusBadge status={transactionStatusVariant(txn.status)}>
                          {transactionStatusLabel(txn.status)}
                        </StatusBadge>
                      )}
                    </Table.Cell>
                    {/* No strike-through on deleted rows: voiding zeroes
                          `total_amount`, so it would strike "Rp 0". The
                          muted row and the "Dihapus" badge carry the state. */}
                    {/* Jumlah item di bawah totalnya, bukan kolom sendiri — di
                        1024px kolom itu yang membuat Total tertutup kolom aksi. */}
                    <Table.Cell className="text-right whitespace-nowrap">
                      <div className="flex flex-col items-end">
                        <span className={isDeleted ? undefined : "font-medium"}>
                          {formatRupiah(txn.total_amount)}
                        </span>
                        <span className="text-xs text-muted">{txn.item_count} item</span>
                      </div>
                    </Table.Cell>
                    <Table.Cell className={STICKY_ACTIONS_CELL}>
                      <TransactionRowActions txn={txn} onOpenDetail={() => onOpenDetail(txn)} />
                    </Table.Cell>
                  </Table.Row>
                )
              })
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  )
}

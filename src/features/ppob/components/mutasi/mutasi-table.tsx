import { ArrowDownCircle, ArrowUpCircle } from "lucide-react"
import { Table } from "@heroui/react"

import { NoData } from "@/components/no-data"
import { id as i18n } from "@/i18n/id"
import { formatDateTime } from "../history/history-utils"
import { VendorStatusBadge } from "../history/vendor-status-badge"
import type { MutasiItem } from "../../types"
import { formatSignedAmount } from "./mutasi-utils"

/**
 * Mutasi sebagai tabel, sebangun dengan riwayat transaksi (DESIGN.md §5.4):
 * arah dibaca dari ikon *dan* tanda pada nominalnya, bukan warna saja.
 */
export function MutasiTable({
  items,
  onSelect,
}: {
  items: MutasiItem[]
  onSelect: (item: MutasiItem) => void
}) {
  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label="Mutasi saldo Mitra">
          <Table.Header>
            <Table.Column id="date">Tanggal</Table.Column>
            <Table.Column isRowHeader id="description">
              Keterangan
            </Table.Column>
            <Table.Column id="reference">Referensi</Table.Column>
            <Table.Column id="status">Status</Table.Column>
            <Table.Column className="text-right" id="amount">
              Nominal
            </Table.Column>
          </Table.Header>
          <Table.Body renderEmptyState={() => <NoData />}>
            {items.map((item, index) => {
              const isIn = item.mutationType === "in"
              const description =
                item.description ?? (isIn ? i18n.ppob.mutasiTopup : i18n.ppob.mutasiPayment)
              return (
                <Table.Row
                  key={item.id ?? index}
                  className="cursor-pointer"
                  id={item.id ?? `mutasi-${index}`}
                  textValue={description}
                  onAction={() => onSelect(item)}
                >
                  <Table.Cell className="whitespace-nowrap text-muted tabular-nums">
                    {formatDateTime(item.createdAt)}
                  </Table.Cell>
                  <Table.Cell className="max-w-64 truncate">
                    <div className="flex items-center gap-2">
                      {isIn ? (
                        <ArrowDownCircle aria-hidden="true" className="size-4 text-success" />
                      ) : (
                        <ArrowUpCircle aria-hidden="true" className="size-4 text-danger" />
                      )}
                      <span className="truncate">{description}</span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-48 truncate font-mono text-muted">
                    {item.reference ?? "-"}
                  </Table.Cell>
                  <Table.Cell>
                    <VendorStatusBadge size="sm" status={item.status} />
                  </Table.Cell>
                  <Table.Cell
                    className={`whitespace-nowrap text-right font-medium tabular-nums ${
                      isIn ? "text-success" : "text-danger"
                    }`}
                  >
                    {formatSignedAmount(item)}
                    {item.paymentMethod && (
                      <span className="block text-xs font-normal text-muted">
                        {item.paymentMethod}
                      </span>
                    )}
                  </Table.Cell>
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  )
}

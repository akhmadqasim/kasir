import { PackageOpen } from "lucide-react"
import { Spinner, Table } from "@heroui/react"

import { NoData } from "@/components/no-data"
import { StatusBadge } from "@/components/status-badge"
import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import { isDiscountedLine, lineDiscountAmount, netLineAmount } from "@/lib/line-amounts"
import { isPpobInFlight, ppobStatusConfig } from "@/lib/ppob-status"
import type { TransactionItem } from "../types"

/**
 * The sold lines of one transaction, each at the price actually paid, with the
 * PPOB state as a badge on the lines that have one. A `Table` like the refund
 * detail dialog, not a grid imitating one — DESIGN.md §5.4.
 */
export function TransactionItemsTable({ items }: { items: TransactionItem[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-foreground">{id.transactions.itemList}</h3>
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label={id.transactions.itemList}>
            <Table.Header>
              <Table.Column isRowHeader>Item</Table.Column>
              <Table.Column className="text-center">Qty</Table.Column>
              <Table.Column className="text-right">Subtotal</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => <NoData icon={<PackageOpen />} title={id.empty.items} />}
            >
              {items.map((item) => {
                const ppobStatus = ppobStatusConfig(item.ppob_status)
                const isDiscounted = isDiscountedLine(item)
                return (
                  <Table.Row key={item.id} id={item.id} textValue={item.product_name}>
                    <Table.Cell className="whitespace-normal">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.product_name}</span>
                        {ppobStatus && (
                          <StatusBadge size="sm" status={ppobStatus.variant}>
                            {isPpobInFlight(item.ppob_status) && (
                              <Spinner className="size-3" color="current" size="sm" />
                            )}
                            {ppobStatus.label}
                          </StatusBadge>
                        )}
                      </div>
                      {isDiscounted && (
                        <p className="text-xs text-danger tabular-nums">
                          Diskon -{formatRupiah(lineDiscountAmount(item))}
                        </p>
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-center tabular-nums">{item.quantity}</Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {isDiscounted && (
                        <p className="text-xs text-muted line-through">
                          {formatRupiah(item.subtotal)}
                        </p>
                      )}
                      <p className="font-medium">{formatRupiah(netLineAmount(item))}</p>
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </section>
  )
}

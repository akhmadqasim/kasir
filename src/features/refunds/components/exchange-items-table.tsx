import { Minus, Plus, Trash2 } from "lucide-react"
import { Button, Table } from "@heroui/react"

import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import type { ExchangeItem } from "../hooks/use-refund-form"

interface ExchangeItemsTableProps {
  items: ExchangeItem[]
  onQuantityChange: (productId: number, quantity: number) => void
  onRemove: (productId: number) => void
}

/** The replacement goods of an exchange, with a stepper and a remove button per row. */
export function ExchangeItemsTable({ items, onQuantityChange, onRemove }: ExchangeItemsTableProps) {
  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label={id.refund.exchangeItems} className="tabular-nums">
          <Table.Header>
            <Table.Column isRowHeader>{id.refund.productName}</Table.Column>
            <Table.Column className="w-36 text-center">Qty</Table.Column>
            <Table.Column className="w-28 text-right">{id.refund.subtotal}</Table.Column>
            <Table.Column className="w-14">
              <span className="sr-only">Aksi</span>
            </Table.Column>
          </Table.Header>
          <Table.Body>
            {items.map((item) => (
              <Table.Row key={item.product_id} id={item.product_id} textValue={item.product_name}>
                <Table.Cell className="whitespace-normal">
                  <div className="min-w-0">
                    <p className="font-medium leading-snug">{item.product_name}</p>
                    <p className="text-xs text-muted">
                      {formatRupiah(item.sell_price)} / {item.unit}
                    </p>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <div className="flex items-center justify-center gap-1">
                    <Button
                      aria-label={`Kurangi jumlah ${item.product_name}`}
                      isDisabled={item.quantity <= 1}
                      isIconOnly
                      size="sm"
                      variant="tertiary"
                      onPress={() => onQuantityChange(item.product_id, item.quantity - 1)}
                    >
                      <Minus />
                    </Button>
                    <span aria-live="polite" className="w-8 text-center font-medium">
                      {item.quantity}
                    </span>
                    <Button
                      aria-label={`Tambah jumlah ${item.product_name}`}
                      isIconOnly
                      size="sm"
                      variant="tertiary"
                      onPress={() => onQuantityChange(item.product_id, item.quantity + 1)}
                    >
                      <Plus />
                    </Button>
                  </div>
                </Table.Cell>
                <Table.Cell className="text-right font-medium whitespace-nowrap">
                  {formatRupiah(item.sell_price * item.quantity)}
                </Table.Cell>
                <Table.Cell>
                  {/* Aksi baris yang merusak: `danger-soft` — DESIGN.md §5.4. */}
                  <Button
                    aria-label={`Hapus ${item.product_name}`}
                    isIconOnly
                    size="sm"
                    variant="danger-soft"
                    onPress={() => onRemove(item.product_id)}
                  >
                    <Trash2 />
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  )
}

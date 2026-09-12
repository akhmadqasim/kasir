import { Button, Modal, Separator, Skeleton, Table } from "@heroui/react"

import { StatusBadge } from "@/components/status-badge"
import { SummaryList, type SummaryItem } from "@/components/summary-list"
import { useApiQuery } from "@/hooks/use-api"
import { getRefundDetail } from "@/lib/api/refunds"
import { queryKeys } from "@/lib/api/query-keys"
import { formatDateTime, formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import { refundConditionBadge, refundTypeLabel } from "../labels"
import type { RefundDetailResult } from "../types"

interface RefundDetailDialogProps {
  refundId: number | null
  onClose: () => void
}

/** Selisih tukar barang: positif toko mengembalikan uang, negatif pelanggan menambah bayar. */
function differenceTone(amount: number): SummaryItem["tone"] {
  if (amount > 0) return "success"
  if (amount < 0) return "danger"
  return "default"
}

export function RefundDetailDialog({ refundId, onClose }: RefundDetailDialogProps) {
  const { data: detail, isLoading } = useApiQuery<RefundDetailResult>(
    queryKeys.refunds.detail(refundId ?? 0),
    () => getRefundDetail(refundId!),
    { enabled: !!refundId },
  )

  const isExchange = detail?.refund.refund_type === "exchange"

  const headerItems: SummaryItem[] = detail
    ? [
        { label: id.refund.refundNumber, value: detail.refund.refund_number, tone: "mono" },
        { label: id.refund.type, value: refundTypeLabel(detail.refund.refund_type) },
        { label: id.refund.transactionReceipt, value: detail.transaction_receipt, tone: "mono" },
        { label: id.refund.cashier, value: detail.cashier_name },
        { label: id.transactions.date, value: formatDateTime(detail.refund.created_at) },
        ...(detail.refund.reason ? [{ label: id.refund.reason, value: detail.refund.reason }] : []),
      ]
    : []

  const summaryItems: SummaryItem[] = detail
    ? [
        {
          label: id.refund.totalRefund,
          value: formatRupiah(detail.refund.total_refund_amount),
          tone: "strong",
        },
        ...(isExchange
          ? [
              {
                label: id.refund.totalExchange,
                value: formatRupiah(detail.refund.total_exchange_amount ?? 0),
              },
              {
                label: id.refund.difference,
                value: formatRupiah(detail.refund.difference_amount ?? 0),
                tone: differenceTone(detail.refund.difference_amount ?? 0),
              },
            ]
          : []),
      ]
    : []

  return (
    <Modal.Backdrop isOpen={!!refundId} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container scroll="inside" size="lg">
        <Modal.Dialog aria-label={id.refund.detail}>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{id.refund.detail}</Modal.Heading>
          </Modal.Header>

          {isLoading || !detail ? (
            <Modal.Body>
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </Modal.Body>
          ) : (
            <Modal.Body>
              <SummaryList items={headerItems} layout="grid" />

              <Separator />

              <div>
                <h4 className="mb-2 font-medium">{id.refund.returnedItems}</h4>
                <Table variant="secondary">
                  <Table.ScrollContainer>
                    <Table.Content aria-label={id.refund.returnedItems} className="tabular-nums">
                      <Table.Header>
                        <Table.Column isRowHeader>{id.refund.productName}</Table.Column>
                        <Table.Column className="text-center">Qty</Table.Column>
                        <Table.Column className="text-right">{id.refund.price}</Table.Column>
                        <Table.Column className="text-right">{id.refund.subtotal}</Table.Column>
                        <Table.Column>{id.refund.condition}</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {detail.items.map((item) => {
                          const condition = refundConditionBadge(item.condition)
                          return (
                            <Table.Row key={item.id} id={item.id} textValue={item.product_name}>
                              <Table.Cell>{item.product_name}</Table.Cell>
                              <Table.Cell className="text-center">{item.quantity}</Table.Cell>
                              <Table.Cell className="text-right">
                                {formatRupiah(item.product_price)}
                              </Table.Cell>
                              <Table.Cell className="text-right">
                                {formatRupiah(item.subtotal)}
                              </Table.Cell>
                              <Table.Cell>
                                {condition ? (
                                  <StatusBadge status={condition.variant}>
                                    {condition.label}
                                  </StatusBadge>
                                ) : (
                                  "—"
                                )}
                              </Table.Cell>
                            </Table.Row>
                          )
                        })}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              </div>

              {isExchange && detail.exchange_items.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="mb-2 font-medium">{id.refund.replacementItems}</h4>
                    <Table variant="secondary">
                      <Table.ScrollContainer>
                        <Table.Content
                          aria-label={id.refund.replacementItems}
                          className="tabular-nums"
                        >
                          <Table.Header>
                            <Table.Column isRowHeader>{id.refund.productName}</Table.Column>
                            <Table.Column className="text-center">Qty</Table.Column>
                            <Table.Column className="text-right">{id.refund.price}</Table.Column>
                            <Table.Column className="text-right">{id.refund.subtotal}</Table.Column>
                          </Table.Header>
                          <Table.Body>
                            {detail.exchange_items.map((item) => (
                              <Table.Row key={item.id} id={item.id} textValue={item.product_name}>
                                <Table.Cell>{item.product_name}</Table.Cell>
                                <Table.Cell className="text-center">{item.quantity}</Table.Cell>
                                <Table.Cell className="text-right">
                                  {formatRupiah(item.product_price)}
                                </Table.Cell>
                                <Table.Cell className="text-right">
                                  {formatRupiah(item.subtotal)}
                                </Table.Cell>
                              </Table.Row>
                            ))}
                          </Table.Body>
                        </Table.Content>
                      </Table.ScrollContainer>
                    </Table>
                  </div>
                </>
              )}

              <Separator />

              <SummaryList items={summaryItems} />
            </Modal.Body>
          )}

          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              {id.refund.cancel}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

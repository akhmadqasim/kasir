import { Button, Modal, Separator, Skeleton, Table } from "@heroui/react"

import { StatusBadge } from "@/components/status-badge"
import { useApiQuery } from "@/hooks/use-api"
import { getRefundDetail } from "@/lib/api/refunds"
import { queryKeys } from "@/lib/api/query-keys"
import { formatDateTime, formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import {
  differenceToneClass,
  refundConditionBadge,
  refundTypeLabel,
  refundTypeVariant,
} from "../labels"
import type { RefundDetailResult } from "../types"

interface RefundDetailDialogProps {
  refundId: number | null
  onClose: () => void
}

export function RefundDetailDialog({ refundId, onClose }: RefundDetailDialogProps) {
  const { data: detail, isLoading } = useApiQuery<RefundDetailResult>(
    queryKeys.refunds.detail(refundId ?? 0),
    () => getRefundDetail(refundId!),
    { enabled: !!refundId }
  )

  const isExchange = detail?.refund.refund_type === "exchange"

  return (
    <Modal.Backdrop isOpen={!!refundId} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container scroll="inside" size="lg">
        <Modal.Dialog aria-label={id.refund.detail}>
          <Modal.Header>
            <Modal.Heading>{id.refund.detail}</Modal.Heading>
            <Modal.CloseTrigger />
          </Modal.Header>

          {isLoading || !detail ? (
            <Modal.Body className="space-y-3">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </Modal.Body>
          ) : (
            <Modal.Body className="space-y-4">
              {/* Header info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted">{id.refund.refundNumber}</p>
                  <p className="font-mono font-medium">{detail.refund.refund_number}</p>
                </div>
                <div>
                  <p className="text-muted">{id.refund.type}</p>
                  <StatusBadge status={refundTypeVariant(detail.refund.refund_type)}>
                    {refundTypeLabel(detail.refund.refund_type)}
                  </StatusBadge>
                </div>
                <div>
                  <p className="text-muted">{id.refund.transactionReceipt}</p>
                  <p className="font-mono">{detail.transaction_receipt}</p>
                </div>
                <div>
                  <p className="text-muted">{id.refund.cashier}</p>
                  <p>{detail.cashier_name}</p>
                </div>
                <div>
                  <p className="text-muted">{id.transactions.date}</p>
                  <p>{formatDateTime(detail.refund.created_at)}</p>
                </div>
                {detail.refund.reason && (
                  <div>
                    <p className="text-muted">{id.refund.reason}</p>
                    <p>{detail.refund.reason}</p>
                  </div>
                )}
              </div>

              <Separator />

              {/* Returned items */}
              <div>
                <h4 className="mb-2 text-sm font-medium">{id.refund.returnedItems}</h4>
                <Table variant="secondary">
                  <Table.ScrollContainer>
                    <Table.Content aria-label={id.refund.returnedItems}>
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
                              <Table.Cell className="text-sm">{item.product_name}</Table.Cell>
                              <Table.Cell className="text-center tabular-nums">{item.quantity}</Table.Cell>
                              <Table.Cell className="text-right tabular-nums">
                                {formatRupiah(item.product_price)}
                              </Table.Cell>
                              <Table.Cell className="text-right tabular-nums">
                                {formatRupiah(item.subtotal)}
                              </Table.Cell>
                              <Table.Cell>
                                {condition ? (
                                  <StatusBadge status={condition.variant}>{condition.label}</StatusBadge>
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

              {/* Exchange items (only for exchange type) */}
              {isExchange && detail.exchange_items.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="mb-2 text-sm font-medium">{id.refund.replacementItems}</h4>
                    <Table variant="secondary">
                      <Table.ScrollContainer>
                        <Table.Content aria-label={id.refund.replacementItems}>
                          <Table.Header>
                            <Table.Column isRowHeader>{id.refund.productName}</Table.Column>
                            <Table.Column className="text-center">Qty</Table.Column>
                            <Table.Column className="text-right">{id.refund.price}</Table.Column>
                            <Table.Column className="text-right">{id.refund.subtotal}</Table.Column>
                          </Table.Header>
                          <Table.Body>
                            {detail.exchange_items.map((item) => (
                              <Table.Row key={item.id} id={item.id} textValue={item.product_name}>
                                <Table.Cell className="text-sm">{item.product_name}</Table.Cell>
                                <Table.Cell className="text-center tabular-nums">{item.quantity}</Table.Cell>
                                <Table.Cell className="text-right tabular-nums">
                                  {formatRupiah(item.product_price)}
                                </Table.Cell>
                                <Table.Cell className="text-right tabular-nums">
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

              {/* Summary */}
              <div className="space-y-1 text-sm">
                <div className="flex justify-between font-semibold">
                  <span>{id.refund.totalRefund}</span>
                  <span className="tabular-nums">{formatRupiah(detail.refund.total_refund_amount)}</span>
                </div>
                {isExchange && (
                  <>
                    <div className="flex justify-between text-muted">
                      <span>{id.refund.totalExchange}</span>
                      <span className="tabular-nums">
                        {formatRupiah(detail.refund.total_exchange_amount ?? 0)}
                      </span>
                    </div>
                    <div
                      className={`flex justify-between font-semibold ${differenceToneClass(detail.refund.difference_amount ?? 0)}`}
                    >
                      <span>{id.refund.difference}</span>
                      <span className="tabular-nums">
                        {formatRupiah(detail.refund.difference_amount ?? 0)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </Modal.Body>
          )}

          <Modal.Footer>
            <Button variant="outline" onPress={onClose}>
              {id.refund.cancel}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

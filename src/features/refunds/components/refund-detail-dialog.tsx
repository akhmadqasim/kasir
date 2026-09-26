import { useState } from "react"
import { Button, Modal, ScrollShadow, Skeleton, Table } from "@heroui/react"

import { InfoPanel } from "@/components/info-panel"
import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { StatusBadge } from "@/components/status-badge"
import { SummaryList, type SummaryItem } from "@/components/summary-list"
import { useApiQuery } from "@/hooks/use-api"
import { getRefundDetail } from "@/lib/api/refunds"
import { queryKeys } from "@/lib/api/query-keys"
import { formatDateTime, formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import { refundConditionBadge, refundTypeLabel, refundTypeVariant } from "../labels"
import { refundTotalsSummary } from "../refund-summary"
import type { RefundDetailResult } from "../types"

interface RefundDetailDialogProps {
  refundId: number | null
  onClose: () => void
}

export function RefundDetailDialog({ refundId, onClose }: RefundDetailDialogProps) {
  // Keep the last refund on screen while the dialog animates out; the parent
  // clears `refundId` the moment it closes.
  const [lastRefundId, setLastRefundId] = useState(refundId)
  if (refundId && refundId !== lastRefundId) setLastRefundId(refundId)
  const currentId = refundId ?? lastRefundId

  const {
    data: detail,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useApiQuery<RefundDetailResult>(
    queryKeys.refunds.detail(currentId ?? 0),
    () => getRefundDetail(currentId!),
    { enabled: !!currentId },
  )

  const isExchange = detail?.refund.refund_type === "exchange"

  const headerItems: SummaryItem[] = detail
    ? [
        { label: id.refund.refundNumber, value: detail.refund.refund_number, tone: "mono" },
        { label: id.refund.transactionReceipt, value: detail.transaction_receipt, tone: "mono" },
        { label: id.refund.cashier, value: detail.cashier_name },
        { label: id.transactions.date, value: formatDateTime(detail.refund.created_at) },
        ...(detail.refund.reason ? [{ label: id.refund.reason, value: detail.refund.reason }] : []),
      ]
    : []

  const summaryItems: SummaryItem[] = detail
    ? refundTotalsSummary({
        isExchange,
        totalRefund: detail.refund.total_refund_amount,
        totalExchange: detail.refund.total_exchange_amount ?? 0,
        difference: detail.refund.difference_amount ?? 0,
      })
    : []

  return (
    <Modal.Backdrop isOpen={!!refundId} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container scroll="inside" size="lg">
        <Modal.Dialog aria-label={id.refund.detail}>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{id.refund.detail}</Modal.Heading>
          </Modal.Header>

          {error && !detail ? (
            <Modal.Body>
              <LoadError
                isRetrying={isFetching}
                title={id.loadFailed.refundDetail}
                onRetry={() => void refetch()}
              >
                {error.message}
              </LoadError>
            </Modal.Body>
          ) : isLoading || !detail ? (
            <Modal.Body aria-busy="true">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-16 w-full" />
            </Modal.Body>
          ) : (
            // Body tidak menggulung sendiri: ScrollShadow di dalamnya yang
            // menggulung, supaya daftar barang yang terpotong di 768px memudar
            // di tepi — tanda bahwa isinya masih berlanjut.
            <Modal.Body className="overflow-visible">
              <ScrollShadow className="-m-[3px] flex min-h-0 flex-1 flex-col gap-4 p-[3px]">
                {/* Bagian dipisah ruang, bukan garis — DESIGN.md §5.7. Tipe refund
                  duduk di kepala bagian sebagai satu lencana, seperti status di
                  dialog detail transaksi. */}
                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium text-foreground">Ringkasan</h3>
                    <StatusBadge status={refundTypeVariant(detail.refund.refund_type)}>
                      {refundTypeLabel(detail.refund.refund_type)}
                    </StatusBadge>
                  </div>
                  <SummaryList items={headerItems} layout="grid" />
                </section>

                <section className="flex flex-col gap-2">
                  <h3 className="font-medium text-foreground">{id.refund.returnedItems}</h3>
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
                        <Table.Body renderEmptyState={() => <NoData title={id.empty.items} />}>
                          {detail.items.map((item) => {
                            const condition = refundConditionBadge(item.condition)
                            return (
                              <Table.Row key={item.id} id={item.id} textValue={item.product_name}>
                                <Table.Cell className="whitespace-normal">
                                  {item.product_name}
                                </Table.Cell>
                                <Table.Cell className="text-center">{item.quantity}</Table.Cell>
                                <Table.Cell className="text-right whitespace-nowrap">
                                  {formatRupiah(item.product_price)}
                                </Table.Cell>
                                <Table.Cell className="text-right font-medium whitespace-nowrap">
                                  {formatRupiah(item.subtotal)}
                                </Table.Cell>
                                <Table.Cell>
                                  {condition ? (
                                    <StatusBadge size="sm" status={condition.variant}>
                                      {condition.label}
                                    </StatusBadge>
                                  ) : (
                                    <span className="text-muted">—</span>
                                  )}
                                </Table.Cell>
                              </Table.Row>
                            )
                          })}
                        </Table.Body>
                      </Table.Content>
                    </Table.ScrollContainer>
                  </Table>
                </section>

                {isExchange && detail.exchange_items.length > 0 && (
                  <section className="flex flex-col gap-2">
                    <h3 className="font-medium text-foreground">{id.refund.replacementItems}</h3>
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
                                <Table.Cell className="whitespace-normal">
                                  {item.product_name}
                                </Table.Cell>
                                <Table.Cell className="text-center">{item.quantity}</Table.Cell>
                                <Table.Cell className="text-right whitespace-nowrap">
                                  {formatRupiah(item.product_price)}
                                </Table.Cell>
                                <Table.Cell className="text-right font-medium whitespace-nowrap">
                                  {formatRupiah(item.subtotal)}
                                </Table.Cell>
                              </Table.Row>
                            ))}
                          </Table.Body>
                        </Table.Content>
                      </Table.ScrollContainer>
                    </Table>
                  </section>
                )}
              </ScrollShadow>
            </Modal.Body>
          )}

          {/* Totals in one box, like "Ringkasan Pembayaran" in the transaction
              detail — the eye finds the money in the same place in both. Pinned
              outside the scrolling body so Selisih stays visible on a 768px
              screen however long the item lists get. */}
          {detail && !isLoading && (
            <div className="mt-4 shrink-0">
              <InfoPanel>
                <SummaryList items={summaryItems} />
              </InfoPanel>
            </div>
          )}

          {/* `.modal__body + .modal__footer` no longer matches once the totals
              sit between them, so the footer spaces itself. */}
          <Modal.Footer className="mt-5">
            {/* Dialog baca-saja: tidak ada yang dibatalkan — DESIGN.md §5.7. */}
            <Button slot="close" variant="tertiary">
              {id.common.close}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

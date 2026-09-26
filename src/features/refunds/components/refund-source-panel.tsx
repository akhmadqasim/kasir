import { PackageOpen } from "lucide-react"
import { Alert, ScrollShadow, Separator, Surface } from "@heroui/react"

import { InfoPanel } from "@/components/info-panel"
import { NoData } from "@/components/no-data"
import { SummaryList } from "@/components/summary-list"
import { formatDateTime, formatRupiah } from "@/lib/format"
import { paymentSplitLabel } from "@/lib/labels"
import { id } from "@/i18n/id"
import type { TransactionDetail, TransactionDetailItem } from "@/features/transactions/types"
import type { RefundItemState } from "../hooks/use-refund-form"
import { RefundItemCard } from "./refund-item-card"

interface RefundSourcePanelProps {
  className: string
  detail: TransactionDetail
  refundableItems: TransactionDetailItem[]
  /** PPOB lines: listed so the cashier sees why they cannot be ticked. */
  nonRefundableItems: TransactionDetailItem[]
  itemStates: Record<number, RefundItemState>
  onUpdateItem: (itemId: number, updates: Partial<RefundItemState>) => void
  /** Why the sale cannot be refunded at all, or `null`. */
  blockedReason: string | null
  hasEarlierRefund: boolean
}

/** Left column of the refund page: the sale being returned and its returnable lines. */
export function RefundSourcePanel({
  className,
  detail,
  refundableItems,
  nonRefundableItems,
  itemStates,
  onUpdateItem,
  blockedReason,
  hasEarlierRefund,
}: RefundSourcePanelProps) {
  return (
    <Surface className={className}>
      <div className="flex flex-col gap-3 p-4">
        <InfoPanel>
          <SummaryList
            items={[
              {
                label: id.transactions.receiptNumber,
                value: detail.transaction.receipt_number,
                tone: "mono",
              },
              {
                label: id.transactions.date,
                value: formatDateTime(detail.transaction.created_at),
              },
              {
                label: id.transactions.paymentMethod,
                value: paymentSplitLabel(
                  detail.transaction.payment_method,
                  detail.payment_breakdown[0]?.bank_name,
                ),
              },
              {
                label: id.transactions.totalAmount,
                value: formatRupiah(detail.transaction.total_amount),
                tone: "strong",
              },
            ]}
          />
        </InfoPanel>

        {blockedReason && (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{blockedReason}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}
        {hasEarlierRefund && (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{id.refund.earlierRefundNote}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}
      </div>

      <Separator />

      <h2 className="px-4 pt-3 text-sm font-medium">{id.refund.refundItems}</h2>
      <ScrollShadow className="min-h-0 flex-1 px-4 pb-4">
        <div className="flex flex-col gap-3 pt-2">
          {refundableItems.length === 0 && (
            <NoData icon={<PackageOpen />} title={id.refund.noReturnableItems} />
          )}
          {refundableItems.map((item) => (
            <RefundItemCard
              key={item.id}
              item={item}
              state={itemStates[item.id]}
              onUpdate={(updates) => onUpdateItem(item.id, updates)}
            />
          ))}
          {nonRefundableItems.length > 0 && (
            <InfoPanel className="flex flex-col gap-1 text-muted">
              <p className="font-medium">{id.refund.nonReturnablePpob}</p>
              <ul className="flex flex-col gap-0.5">
                {nonRefundableItems.map((item) => (
                  <li key={item.id}>
                    {item.product_name} × {item.quantity}
                  </li>
                ))}
              </ul>
            </InfoPanel>
          )}
        </div>
      </ScrollShadow>
    </Surface>
  )
}

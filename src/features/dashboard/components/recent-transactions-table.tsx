import { Table } from "@heroui/react"

import { StatusBadge } from "@/components/status-badge"
import { id as t } from "@/i18n/id"
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format"
import { paymentMethodLabel, transactionStatusLabel, transactionStatusVariant } from "@/lib/labels"
import { useRecentTransactions } from "../hooks/use-dashboard"
import { NoData, SectionCard } from "./section-card"

export function RecentTransactionsTable() {
  const { data: recentTx } = useRecentTransactions()
  const rows = recentTx ?? []

  return (
    <SectionCard title={t.dashboard.recentTransactions}>
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label={t.dashboard.recentTransactions} className="min-w-[720px]">
            <Table.Header>
              <Table.Column isRowHeader>{t.dashboard.receipt}</Table.Column>
              <Table.Column>{t.dashboard.cashier}</Table.Column>
              <Table.Column>Metode</Table.Column>
              <Table.Column>Tanggal</Table.Column>
              <Table.Column className="text-center">Item</Table.Column>
              <Table.Column className="text-right">{t.dashboard.amount}</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => <NoData />}>
              {rows.map((tx) => (
                <Table.Row key={tx.id} id={tx.id} textValue={tx.receiptNumber}>
                  <Table.Cell className="font-medium">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{tx.receiptNumber}</span>
                      {/*
                        `query_recent_transactions` filters out deleted, refunded and
                        unfulfilled PPOB rows, so only `completed` and `partial_refund`
                        reach here. The partial ones still show their full original
                        amount, which is the one case worth flagging.
                      */}
                      {tx.status !== "completed" && (
                        <StatusBadge size="sm" status={transactionStatusVariant(tx.status)}>
                          {transactionStatusLabel(tx.status)}
                        </StatusBadge>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell>{tx.cashierName}</Table.Cell>
                  <Table.Cell>{paymentMethodLabel(tx.paymentMethod)}</Table.Cell>
                  <Table.Cell className="text-muted">{formatDateTime(tx.createdAt)}</Table.Cell>
                  <Table.Cell className="text-center tabular-nums">
                    {formatNumber(tx.totalItems)}
                  </Table.Cell>
                  <Table.Cell className="text-right font-medium tabular-nums">
                    {formatRupiah(tx.totalAmount)}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </SectionCard>
  )
}

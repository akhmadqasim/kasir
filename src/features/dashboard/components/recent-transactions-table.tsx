import { Table } from "@heroui/react"
import { ReceiptTextIcon } from "lucide-react"

import { StatusBadge } from "@/components/status-badge"
import { id as t } from "@/i18n/id"
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format"
import { paymentMethodLabel, transactionStatusLabel, transactionStatusVariant } from "@/lib/labels"
import { useRecentTransactions } from "../hooks/use-dashboard"
import { DashboardTable } from "./dashboard-table"

export function RecentTransactionsTable() {
  const { data: recentTx, isLoading, isFetching, error, refetch } = useRecentTransactions()

  return (
    <DashboardTable
      columnCount={6}
      contentClassName="min-w-[720px]"
      emptyDescription={t.empty.recentTransactionsHint}
      emptyIcon={<ReceiptTextIcon />}
      emptyTitle={t.transactions.noTransactions}
      error={error}
      isLoading={isLoading}
      title={t.dashboard.recentTransactions}
      columns={
        <>
          <Table.Column isRowHeader>{t.dashboard.receipt}</Table.Column>
          <Table.Column>{t.dashboard.cashier}</Table.Column>
          <Table.Column>Metode</Table.Column>
          <Table.Column>Tanggal</Table.Column>
          <Table.Column className="text-right">Item</Table.Column>
          <Table.Column className="text-right">{t.dashboard.amount}</Table.Column>
        </>
      }
      isRetrying={isFetching}
      onRetry={() => void refetch()}
    >
      {(recentTx ?? []).map((tx) => (
        <Table.Row key={tx.id} id={tx.id} textValue={tx.receiptNumber}>
          <Table.Cell className="font-medium">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{tx.receiptNumber}</span>
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
          <Table.Cell className="whitespace-nowrap text-muted">
            {formatDateTime(tx.createdAt)}
          </Table.Cell>
          <Table.Cell className="text-right">{formatNumber(tx.totalItems)}</Table.Cell>
          <Table.Cell className="text-right font-medium whitespace-nowrap">
            {formatRupiah(tx.totalAmount)}
          </Table.Cell>
        </Table.Row>
      ))}
    </DashboardTable>
  )
}

import { Table } from "@heroui/react"
import { TrophyIcon } from "lucide-react"

import { RankBadge } from "@/components/rank-badge"
import { id as t } from "@/i18n/id"
import { formatNumber, formatRupiah } from "@/lib/format"
import { useTopProducts } from "../hooks/use-dashboard"
import { DashboardTable } from "./dashboard-table"

export function TopProductsTable({ limit = 10 }: { limit?: number }) {
  const { data: topProducts, isLoading, isFetching, error, refetch } = useTopProducts(limit)

  return (
    <DashboardTable
      columnCount={3}
      emptyIcon={<TrophyIcon />}
      emptyTitle={t.empty.productsSold}
      error={error}
      isLoading={isLoading}
      title={t.dashboard.topProducts}
      columns={
        <>
          <Table.Column isRowHeader>{t.dashboard.productName}</Table.Column>
          <Table.Column className="text-right">{t.dashboard.qtySold}</Table.Column>
          <Table.Column className="text-right">{t.dashboard.totalRevenue}</Table.Column>
        </>
      }
      isRetrying={isFetching}
      onRetry={() => void refetch()}
    >
      {(topProducts ?? []).map((product, index) => (
        <Table.Row key={product.productId} id={product.productId} textValue={product.productName}>
          <Table.Cell className="max-w-[280px] font-medium">
            <span className="flex min-w-0 items-center gap-2">
              <RankBadge rank={index + 1} />
              <span className="truncate">{product.productName}</span>
            </span>
          </Table.Cell>
          <Table.Cell className="text-right">{formatNumber(product.totalQty)}</Table.Cell>
          <Table.Cell className="text-right">{formatRupiah(product.totalRevenue)}</Table.Cell>
        </Table.Row>
      ))}
    </DashboardTable>
  )
}

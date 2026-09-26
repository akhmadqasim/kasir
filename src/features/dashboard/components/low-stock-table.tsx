import { Table } from "@heroui/react"
import { PackageCheckIcon } from "lucide-react"

import { StatusBadge } from "@/components/status-badge"
import { id as t } from "@/i18n/id"
import { formatNumber } from "@/lib/format"
import { useLowStockProducts } from "../hooks/use-dashboard"
import { DashboardTable } from "./dashboard-table"

export function LowStockTable() {
  const { data: lowStock, isLoading, isFetching, error, refetch } = useLowStockProducts()

  return (
    <DashboardTable
      columnCount={3}
      emptyDescription={t.empty.lowStockHint}
      emptyIcon={<PackageCheckIcon />}
      emptyTitle={t.empty.lowStock}
      error={error}
      isLoading={isLoading}
      title={t.dashboard.lowStock}
      columns={
        <>
          <Table.Column isRowHeader>{t.dashboard.product}</Table.Column>
          <Table.Column className="text-right">{t.dashboard.stock}</Table.Column>
          <Table.Column className="text-right">{t.dashboard.minStock}</Table.Column>
        </>
      }
      isRetrying={isFetching}
      onRetry={() => void refetch()}
    >
      {(lowStock ?? []).map((product) => {
        const isOut = product.stock <= 0
        return (
          <Table.Row key={product.id} id={product.id} textValue={product.name}>
            <Table.Cell className="max-w-[280px] truncate font-medium">{product.name}</Table.Cell>
            {/*
              Setiap baris di sini sudah di bawah `min_stock`, jadi statusnya
              peringatan; stok nol atau minus sudah kehabisan dan diberi warna error.
              Kata "habis"/"menipis" untuk pembaca layar, karena di layar bedanya
              hanya warna lencananya.
            */}
            <Table.Cell className="text-right">
              <StatusBadge size="sm" status={isOut ? "error" : "warning"}>
                {formatNumber(product.stock)} {product.unit}
                <span className="sr-only">{isOut ? ", habis" : ", menipis"}</span>
              </StatusBadge>
            </Table.Cell>
            <Table.Cell className="text-right text-muted">
              {formatNumber(product.minStock)} {product.unit}
            </Table.Cell>
          </Table.Row>
        )
      })}
    </DashboardTable>
  )
}

import { Table } from "@heroui/react"

import { StatusBadge } from "@/components/status-badge"
import { id as t } from "@/i18n/id"
import { useLowStockProducts } from "../hooks/use-dashboard"
import { NoData, SectionCard } from "./section-card"

export function LowStockTable() {
  const { data: lowStock } = useLowStockProducts()
  const rows = lowStock ?? []

  return (
    <SectionCard title={t.dashboard.lowStock}>
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label={t.dashboard.lowStock}>
            <Table.Header>
              <Table.Column isRowHeader>{t.dashboard.product}</Table.Column>
              <Table.Column className="text-right">{t.dashboard.stock}</Table.Column>
              <Table.Column className="text-right">{t.dashboard.minStock}</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => <NoData />}>
              {rows.map((product) => (
                <Table.Row key={product.id} id={product.id} textValue={product.name}>
                  <Table.Cell className="max-w-[280px] truncate font-medium">
                    {product.name}
                  </Table.Cell>
                  {/*
                    Setiap baris di sini sudah di bawah `min_stock`, jadi statusnya
                    peringatan; stok nol sudah kehabisan dan diberi warna error.
                  */}
                  <Table.Cell className="text-right">
                    <StatusBadge size="sm" status={product.stock === 0 ? "error" : "warning"}>
                      {product.stock} {product.unit}
                    </StatusBadge>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums text-muted">
                    {product.minStock} {product.unit}
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

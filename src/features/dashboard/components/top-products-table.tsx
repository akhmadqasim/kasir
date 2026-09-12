import { Table } from "@heroui/react"

import { id as t } from "@/i18n/id"
import { formatNumber, formatRupiah } from "@/lib/format"
import { useTopProducts } from "../hooks/use-dashboard"
import { NoData } from "@/components/no-data"
import { SectionCard } from "./section-card"

export function TopProductsTable({ limit = 10 }: { limit?: number }) {
  const { data: topProducts } = useTopProducts(limit)
  const rows = topProducts ?? []

  return (
    <SectionCard title={t.dashboard.topProducts}>
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label={t.dashboard.topProducts}>
            <Table.Header>
              <Table.Column isRowHeader>{t.dashboard.productName}</Table.Column>
              <Table.Column className="text-right">{t.dashboard.qtySold}</Table.Column>
              <Table.Column className="text-right">{t.dashboard.totalRevenue}</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => <NoData />}>
              {rows.map((product) => (
                <Table.Row
                  key={product.productId}
                  id={product.productId}
                  textValue={product.productName}
                >
                  <Table.Cell className="max-w-[280px] truncate font-medium">
                    {product.productName}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {formatNumber(product.totalQty)}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {formatRupiah(product.totalRevenue)}
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

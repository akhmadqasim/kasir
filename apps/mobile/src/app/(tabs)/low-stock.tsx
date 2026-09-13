import { id } from "@kasir/shared";
import type { JSX } from "react";

import { PageHeader } from "@/components/page-header";
import { ProductList } from "@/components/product-list";
import { Screen } from "@/components/screen";
import { useProductSearch } from "@/hooks/use-products";

/**
 * `GET /products?quick_filter=low_stock` — the same `stock <= COALESCE(min_stock, 0)`
 * rule the desktop's product table, dashboard and stock report all share.
 */
export default function LowStockTab(): JSX.Element {
  const result = useProductSearch({ query: "", quick_filter: "low_stock" });

  return (
    <Screen>
      <ProductList
        result={result}
        header={<PageHeader title={id.lowStock.title} subtitle={id.lowStock.description} />}
        emptyMessage={id.lowStock.empty}
        emphasizeStock
      />
    </Screen>
  );
}

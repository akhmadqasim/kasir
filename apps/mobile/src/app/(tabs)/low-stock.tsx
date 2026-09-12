import { id } from "@kasir/shared";
import { Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

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
      <View className="py-3">
        <Typography type="body-sm" color="muted">
          {id.lowStock.description}
        </Typography>
      </View>
      <ProductList result={result} emptyMessage={id.lowStock.empty} emphasizeStock />
    </Screen>
  );
}

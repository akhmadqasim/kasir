import { formatNumber, formatRupiah, id, isLowStock, type Product } from "@kasir/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ListGroup, Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

import { primeProduct } from "@/hooks/use-products";

interface ProductRowProps {
  product: Product;
  /** Show "stok / min" instead of the price, for the low-stock list. */
  emphasizeStock?: boolean;
}

/**
 * One product in a list. Name and price, stock on the right; the low-stock
 * variant swaps the price for the threshold, because there the question is
 * "how far under" rather than "how much".
 */
export function ProductRow({ product, emphasizeStock = false }: ProductRowProps): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const low = isLowStock(product);

  const open = () => {
    primeProduct(queryClient, product);
    router.push({ pathname: "/products/[id]", params: { id: String(product.id) } });
  };

  return (
    <ListGroup.Item onPress={open} accessibilityRole="button" accessibilityLabel={product.name}>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle numberOfLines={2}>{product.name}</ListGroup.ItemTitle>
        <ListGroup.ItemDescription>
          {emphasizeStock
            ? `${id.lowStock.count}: ${formatNumber(product.stock)} / ${formatNumber(product.min_stock)} ${product.unit}`
            : formatRupiah(product.sell_price)}
        </ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix>
        <View className="items-end">
          <Typography weight="medium" className={low ? "text-danger" : undefined}>
            {formatNumber(product.stock)}
          </Typography>
          <Typography type="body-xs" color="muted">
            {product.unit}
          </Typography>
        </View>
      </ListGroup.ItemSuffix>
    </ListGroup.Item>
  );
}

import { formatNumber, isLowStock, productRowSubtitle, type Product } from "@kasir/shared";
import { ListGroup, Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

import { useOpenProduct } from "@/hooks/use-open-product";

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
  const open = useOpenProduct();
  const low = isLowStock(product);

  return (
    <ListGroup.Item
      onPress={() => open(product)}
      accessibilityRole="button"
      accessibilityLabel={product.name}
    >
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle numberOfLines={2}>{product.name}</ListGroup.ItemTitle>
        <ListGroup.ItemDescription>
          {productRowSubtitle(product, emphasizeStock)}
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

import {
  canEditProduct,
  canSeeBuyPrice,
  categoryLabel,
  formatNumber,
  formatRupiah,
  id,
  isLowStock,
} from "@kasir/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Card, Chip, Separator } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

import { FieldRow } from "@/components/field-row";
import { ScrollScreen } from "@/components/screen";
import { ErrorView, LoadingView } from "@/components/state-view";
import { useCategories, useProductDetail } from "@/hooks/use-products";
import { useCurrentUser } from "@/hooks/use-session";

/**
 * Everything about one product, and the stock actions this role may take.
 *
 * Gating here is a courtesy: the server checks the same role from the session
 * and refuses regardless. What the UI enforces on its own is *visibility* —
 * a kasir never sees the buying price.
 */
export default function ProductDetailScreen(): JSX.Element {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const productId = Number(rawId);
  const router = useRouter();
  const user = useCurrentUser();
  const product = useProductDetail(productId);
  const categories = useCategories();

  if (product.isPending) return <LoadingView />;
  if (product.isError) {
    return (
      <ScrollScreen>
        <ErrorView error={product.error} onRetry={() => void product.refetch()} />
      </ScrollScreen>
    );
  }

  const item = product.data;
  const category = categories.data?.find((entry) => entry.id === item.category_id)?.name;
  const low = isLowStock(item);
  const params = { id: String(item.id) };

  return (
    <ScrollScreen>
      <Card>
        <Card.Header className="flex-row items-start justify-between gap-3">
          <Card.Title className="flex-1">{item.name}</Card.Title>
          {low ? (
            <Chip color="danger" variant="secondary" size="sm">
              <Chip.Label>{id.products.lowStockBadge}</Chip.Label>
            </Chip>
          ) : null}
        </Card.Header>
        <Card.Body>
          <FieldRow
            label={id.products.stock}
            value={`${formatNumber(item.stock)} ${item.unit}`}
            emphasize
            danger={low}
          />
          <Separator />
          <FieldRow label={id.products.minStock} value={formatNumber(item.min_stock)} />
          <FieldRow label={id.products.sellPrice} value={formatRupiah(item.sell_price)} />
          {canSeeBuyPrice(user.role) ? (
            <FieldRow label={id.products.buyPrice} value={formatRupiah(item.buy_price)} />
          ) : null}
          <Separator />
          <FieldRow label={id.products.barcode} value={item.barcode ?? "—"} />
          <FieldRow label={id.products.sku} value={item.sku ?? "—"} />
          <FieldRow label={id.products.category} value={categoryLabel(category)} />
          <FieldRow label={id.products.unit} value={item.unit} />
        </Card.Body>
      </Card>

      <View className="gap-3">
        <Button onPress={() => router.push({ pathname: "/products/[id]/count", params })}>
          {id.stock.count}
        </Button>
        <Button
          variant="secondary"
          onPress={() => router.push({ pathname: "/products/[id]/writeoff", params })}
        >
          {id.stock.writeoff}
        </Button>
        {canEditProduct(user.role) ? (
          <Button
            variant="tertiary"
            onPress={() => router.push({ pathname: "/products/[id]/edit", params })}
          >
            {id.products.editPrice}
          </Button>
        ) : null}
      </View>
    </ScrollScreen>
  );
}

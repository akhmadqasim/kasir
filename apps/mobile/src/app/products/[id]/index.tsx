import {
  canEditProduct,
  canSeeBuyPrice,
  categoryLabel,
  formatNumber,
  formatRupiah,
  id,
  isLowStock,
} from "@kasir/shared";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Chip, Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

import { FieldRow } from "@/components/field-row";
import { HeaderActions, type HeaderAction } from "@/components/header-actions";
import { ScrollScreen } from "@/components/screen";
import { Section } from "@/components/section";
import { ErrorView, LoadingView } from "@/components/state-view";
import { useCategories, useProductDetail } from "@/hooks/use-products";
import { useCurrentUser } from "@/hooks/use-session";

/**
 * Everything about one product, and the stock actions this role may take.
 *
 * The facts are grouped the way the questions come — how many are there, what
 * does it cost, which item is this — and the actions live in the navigation
 * bar, which is where both platforms keep a screen's actions and the only bar
 * on this screen that is not already the tab bar.
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

  const actions: HeaderAction[] = [
    {
      key: "count",
      label: id.stock.count,
      sf: "checklist",
      md: "clipboard-check-outline",
      onPress: () => router.push({ pathname: "/products/[id]/count", params }),
    },
    {
      key: "writeoff",
      label: id.stock.writeoff,
      sf: "trash",
      md: "trash-can-outline",
      destructive: true,
      onPress: () => router.push({ pathname: "/products/[id]/writeoff", params }),
    },
  ];

  if (canEditProduct(user.role)) {
    actions.push({
      key: "edit",
      label: id.products.editPriceShort,
      sf: "tag",
      md: "tag-outline",
      onPress: () => router.push({ pathname: "/products/[id]/edit", params }),
    });
  }

  return (
    <ScrollScreen>
      <Stack.Screen options={{ headerRight: () => <HeaderActions actions={actions} /> }} />

      <View className="flex-row items-start justify-between gap-3">
        <Typography.Heading type="h4" className="flex-1">
          {item.name}
        </Typography.Heading>
        {low ? (
          <Chip color="danger" variant="secondary" size="sm">
            <Chip.Label>{id.products.lowStockBadge}</Chip.Label>
          </Chip>
        ) : null}
      </View>

      <Section title={id.products.sectionStock}>
        <FieldRow
          label={id.products.stock}
          value={`${formatNumber(item.stock)} ${item.unit}`}
          emphasize
          danger={low}
        />
        <FieldRow label={id.products.minStock} value={formatNumber(item.min_stock)} />
      </Section>

      <Section title={id.products.sectionPrice}>
        <FieldRow label={id.products.sellPrice} value={formatRupiah(item.sell_price)} />
        {canSeeBuyPrice(user.role) ? (
          <FieldRow label={id.products.buyPrice} value={formatRupiah(item.buy_price)} />
        ) : null}
      </Section>

      <Section title={id.products.sectionIdentity}>
        <FieldRow label={id.products.barcode} value={item.barcode ?? "—"} />
        <FieldRow label={id.products.sku} value={item.sku ?? "—"} />
        <FieldRow label={id.products.category} value={categoryLabel(category)} />
        <FieldRow label={id.products.unit} value={item.unit} />
      </Section>
    </ScrollScreen>
  );
}

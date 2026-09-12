import { id, type Product } from "@kasir/shared";
import { Separator, Spinner } from "heroui-native";
import type { JSX, ReactNode } from "react";
import { FlatList, RefreshControl, View } from "react-native";

import { ProductRow } from "@/components/product-row";
import { useHeaderlessScrollProps } from "@/components/screen";
import { EmptyView, ErrorView, LoadingView } from "@/components/state-view";
import type { useProductSearch } from "@/hooks/use-products";

/** So `ListEmptyComponent` can centre itself in the whole list, not in zero height. */
const GROW = { flexGrow: 1 } as const;

type SearchResult = ReturnType<typeof useProductSearch>;

interface ProductListProps {
  result: SearchResult;
  /**
   * Title and search field. They ride inside the list rather than above it so
   * the tab has exactly one scroll view: that is what lets iOS apply its
   * automatic content insets (status bar at the top, Liquid Glass tab bar at
   * the bottom) and what lets the tab bar minimize as the list scrolls down.
   */
  header?: ReactNode;
  emptyMessage?: string;
  emphasizeStock?: boolean;
}

function RowSeparator(): JSX.Element {
  return <Separator className="mx-4" />;
}

/**
 * The paged list both the Produk and Stok Menipis tabs draw. Pull to refresh,
 * scroll to the end for the next page.
 *
 * Rows are full-bleed with hairline separators — a plain list on iOS, a Material
 * list on Android — rather than an inset card, because a card that runs the whole
 * height of the screen is a card with no edges to see.
 */
export function ProductList({
  result,
  header,
  emptyMessage = id.products.noProducts,
  emphasizeStock,
}: ProductListProps): JSX.Element {
  const products: Product[] = result.data?.pages.flatMap((page) => page.data) ?? [];
  // Both tabs that draw this list are `NativeTabs` screens, so there is no header.
  const scrollProps = useHeaderlessScrollProps(true);

  const placeholder = result.isPending ? (
    <LoadingView />
  ) : result.isError ? (
    <View className="px-4">
      <ErrorView error={result.error} onRetry={() => void result.refetch()} />
    </View>
  ) : (
    <EmptyView message={emptyMessage} />
  );

  return (
    <FlatList
      className="flex-1"
      data={products}
      keyExtractor={(product) => String(product.id)}
      ItemSeparatorComponent={RowSeparator}
      keyboardShouldPersistTaps="handled"
      {...scrollProps}
      contentContainerStyle={[GROW, scrollProps.contentContainerStyle]}
      contentContainerClassName="pb-8"
      ListHeaderComponent={header ? <View className="gap-3 px-4 pb-2">{header}</View> : null}
      ListEmptyComponent={placeholder}
      refreshControl={
        <RefreshControl
          refreshing={result.isRefetching && !result.isFetchingNextPage}
          onRefresh={() => void result.refetch()}
        />
      }
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (result.hasNextPage && !result.isFetchingNextPage) void result.fetchNextPage();
      }}
      ListFooterComponent={
        result.isFetchingNextPage ? (
          <View className="items-center py-4">
            <Spinner size="sm" />
          </View>
        ) : null
      }
      renderItem={({ item }) => <ProductRow product={item} emphasizeStock={emphasizeStock} />}
    />
  );
}

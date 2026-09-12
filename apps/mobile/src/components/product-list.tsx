import { id, type Product } from "@kasir/shared";
import { Separator, Spinner } from "heroui-native";
import type { JSX, ReactNode } from "react";
import { FlatList, RefreshControl, ScrollView, View } from "react-native";

import { NativeProductList } from "@/components/native-list";
import { ProductRow } from "@/components/product-row";
import { useHeaderlessScrollProps } from "@/components/screen";
import { EmptyView, ErrorView, LoadingView } from "@/components/state-view";
import { useOpenProduct } from "@/hooks/use-open-product";
import type { useProductSearch } from "@/hooks/use-products";
import { hasSwiftUI } from "@/lib/native-modules";

/** So `ListEmptyComponent` can centre itself in the whole list, not in zero height. */
const GROW = { flexGrow: 1 } as const;

type SearchResult = ReturnType<typeof useProductSearch>;

interface ProductListProps {
  result: SearchResult;
  /**
   * Title and search field. On the React Native path they ride inside the list,
   * so the tab has one scroll view and iOS can apply its own content insets;
   * with the SwiftUI list they stay pinned above it, the way a docked search
   * bar behaves.
   */
  header?: ReactNode;
  emptyMessage?: string;
  emphasizeStock?: boolean;
}

function RowSeparator(): JSX.Element {
  return <Separator className="mx-4" />;
}

/**
 * The paged list both the Produk and Stok Menipis tabs draw.
 *
 * On iOS it is UIKit's own inset-grouped list through `@expo/ui/swift-ui`;
 * everywhere else it is a `FlatList` of Material 3 rows. Both read the same
 * `useProductSearch` result and open products through the same hook, so paging,
 * refreshing and role rules do not change with the drawing.
 */
export function ProductList({
  result,
  header,
  emptyMessage = id.products.noProducts,
  emphasizeStock = false,
}: ProductListProps): JSX.Element {
  const products: Product[] = result.data?.pages.flatMap((page) => page.data) ?? [];
  const scrollProps = useHeaderlessScrollProps(true);
  const openProduct = useOpenProduct();

  const loadNextPage = () => {
    if (result.hasNextPage && !result.isFetchingNextPage) void result.fetchNextPage();
  };

  const placeholder = result.isPending ? (
    <LoadingView />
  ) : result.isError ? (
    <View className="px-4">
      <ErrorView error={result.error} onRetry={() => void result.refetch()} />
    </View>
  ) : (
    <EmptyView message={emptyMessage} />
  );

  if (hasSwiftUI) {
    return (
      <View className="flex-1">
        {header ? <View className="gap-3 px-4 pb-2">{header}</View> : null}
        {products.length === 0 ? (
          /*
           * The SwiftUI list is not mounted when there is nothing to show, and
           * its `refreshable` goes with it — so the placeholder carries its own
           * pull-to-refresh. Without it an empty search result is a dead end:
           * no gesture, and nothing to tap.
           */
          <ScrollView
            className="flex-1"
            contentContainerStyle={GROW}
            refreshControl={
              <RefreshControl
                refreshing={result.isRefetching}
                onRefresh={() => void result.refetch()}
              />
            }
          >
            {placeholder}
          </ScrollView>
        ) : (
          <NativeProductList
            products={products}
            emphasizeStock={emphasizeStock}
            onSelect={openProduct}
            onRefresh={() => result.refetch()}
            onEndReached={loadNextPage}
          />
        )}
      </View>
    );
  }

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
      onEndReached={loadNextPage}
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

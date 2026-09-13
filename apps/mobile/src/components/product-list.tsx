import { id, type Product } from "@kasir/shared";
import { Separator, Spinner } from "heroui-native";
import type { JSX, ReactNode } from "react";
import { FlatList, RefreshControl, View } from "react-native";

import { ProductRow } from "@/components/product-row";
import { useHeaderlessScrollProps } from "@/components/screen";
import { EmptyView, ErrorView, LoadingView } from "@/components/state-view";
import type { useProductSearch } from "@/hooks/use-products";
import { isIOS } from "@/lib/platform";

/** So `ListEmptyComponent` can centre itself in the whole list, not in zero height. */
const GROW = { flexGrow: 1 } as const;

type SearchResult = ReturnType<typeof useProductSearch>;

interface ProductListProps {
  result: SearchResult;
  /**
   * Title, search field, and anything else above the rows.
   *
   * It rides *inside* the list rather than above it, and that is load-bearing:
   * a tab screen has no navigation header, so the only thing that applies the
   * status-bar inset on iOS is the scroll view's own content-inset adjustment.
   * A header placed outside the list gets no inset and runs under the clock.
   */
  header?: ReactNode;
  emptyMessage?: string;
  emphasizeStock?: boolean;
}

function RowSeparator(): JSX.Element {
  // iOS insets a separator to where the row's text starts; Material 3 runs it
  // to the edges when it draws one at all.
  return <Separator className={isIOS ? "ml-4" : "mx-4"} />;
}

/**
 * The paged product list behind the Produk, Stok Menipis and Scan tabs. Pull to
 * refresh, scroll to the end for the next page.
 *
 * Rows are full-bleed with hairlines rather than an inset card. That is the
 * plain list style iOS itself uses for a long, scrolling, searchable list —
 * inset-grouped is for short groups of related rows, which is what `Section`
 * draws elsewhere — and a rounded card running the whole height of the screen
 * has no edges left to see.
 */
export function ProductList({
  result,
  header,
  emptyMessage = id.products.noProducts,
  emphasizeStock = false,
}: ProductListProps): JSX.Element {
  const products: Product[] = result.data?.pages.flatMap((page) => page.data) ?? [];
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
      keyboardDismissMode={isIOS ? "interactive" : "on-drag"}
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

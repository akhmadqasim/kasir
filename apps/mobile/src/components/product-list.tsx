import { id, type Product } from "@kasir/shared";
import { ListGroup, Separator, Spinner } from "heroui-native";
import type { JSX } from "react";
import { FlatList, RefreshControl, View } from "react-native";

import { ProductRow } from "@/components/product-row";
import { EmptyView, ErrorView, LoadingView } from "@/components/state-view";
import type { useProductSearch } from "@/hooks/use-products";

type SearchResult = ReturnType<typeof useProductSearch>;

interface ProductListProps {
  result: SearchResult;
  emptyMessage?: string;
  emphasizeStock?: boolean;
}

function RowSeparator(): JSX.Element {
  return <Separator className="mx-4" />;
}

/**
 * The paged list both the Produk and Stok Menipis tabs draw. Pull to refresh,
 * scroll to the end for the next page. The rows live inside one `ListGroup`
 * surface so they read as a single grouped list, the way the docs compose it.
 */
export function ProductList({
  result,
  emptyMessage = id.products.noProducts,
  emphasizeStock,
}: ProductListProps): JSX.Element {
  const products: Product[] = result.data?.pages.flatMap((page) => page.data) ?? [];

  if (result.isPending) return <LoadingView />;

  if (result.isError) {
    return <ErrorView error={result.error} onRetry={() => void result.refetch()} />;
  }

  if (products.length === 0) return <EmptyView message={emptyMessage} />;

  return (
    <ListGroup className="flex-1 p-0 mb-4">
      <FlatList
        data={products}
        keyExtractor={(product) => String(product.id)}
        ItemSeparatorComponent={RowSeparator}
        keyboardShouldPersistTaps="handled"
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
    </ListGroup>
  );
}

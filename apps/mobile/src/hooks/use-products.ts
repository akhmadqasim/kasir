import {
  ApiError,
  queryKeys,
  type Category,
  type CreateProductInput,
  type CreateStockWriteoffInput,
  type PaginatedProducts,
  type Product,
  type ProductPatch,
  type SearchProductsParams,
  type StockWriteoff,
  id,
} from "@kasir/shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { productsApi, stockApi } from "@/lib/api";

export const PRODUCTS_PAGE_SIZE = 50;

/**
 * Paged product search. `query` is already debounced by the caller. The
 * parameters are exactly what the desktop sends (`src/lib/api/products.ts`).
 */
export function useProductSearch(params: Pick<SearchProductsParams, "query" | "quick_filter">) {
  const base: SearchProductsParams = {
    query: params.query ?? "",
    quick_filter: params.quick_filter,
    per_page: PRODUCTS_PAGE_SIZE,
    sort_by: "name",
    sort_order: "asc",
  };

  return useInfiniteQuery<PaginatedProducts, Error>({
    queryKey: queryKeys.products.search(base),
    queryFn: ({ pageParam }) => productsApi.search({ ...base, page: pageParam as number }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.total_pages ? last.page + 1 : undefined),
  });
}

/**
 * Put a product the list or the scanner already has into the detail cache, so
 * the detail screen renders at once and knows how to re-read it (there is no
 * `GET /products/{id}`; see `packages/shared/src/api/products.ts`).
 */
export function primeProduct(queryClient: QueryClient, product: Product): void {
  queryClient.setQueryData<Product>(queryKeys.products.detail(product.id), product);
}

export function useProductDetail(productId: number) {
  const queryClient = useQueryClient();

  return useQuery<Product, Error>({
    queryKey: queryKeys.products.detail(productId),
    queryFn: async () => {
      const seed = queryClient.getQueryData<Product>(queryKeys.products.detail(productId));
      if (!seed) {
        throw new ApiError("not_found", id.scan.notFound, 404);
      }
      const fresh = await productsApi.refetch(seed);
      if (!fresh) {
        throw new ApiError("not_found", id.scan.notFound, 404);
      }
      return fresh;
    },
    // The seed is fresh enough for the first paint; a re-read happens on the
    // next focus or after a mutation, not on every mount.
    staleTime: 60_000,
  });
}

export function useProductByBarcode(barcode: string | null) {
  return useQuery<Product | null, Error>({
    queryKey: queryKeys.products.byBarcode(barcode ?? ""),
    queryFn: () => productsApi.getByBarcode(barcode ?? ""),
    enabled: barcode !== null && barcode.length > 0,
    staleTime: 0,
  });
}

export function useCategories() {
  return useQuery<Category[], Error>({
    queryKey: queryKeys.categories.list,
    queryFn: () => productsApi.listCategories(),
    staleTime: 5 * 60_000,
  });
}

function afterProductChange(queryClient: QueryClient, product: Product): void {
  primeProduct(queryClient, product);
  if (product.barcode) {
    queryClient.setQueryData<Product | null>(
      queryKeys.products.byBarcode(product.barcode),
      product
    );
  }
  void queryClient.invalidateQueries({ queryKey: queryKeys.products.searchAll });
}

/** Admin: sell/buy price, min_stock, category. */
export function usePatchProduct() {
  const queryClient = useQueryClient();
  return useMutation<Product, Error, { product: Product; patch: ProductPatch }>({
    mutationFn: ({ product, patch }) => productsApi.patch(product, patch),
    onSuccess: (product) => afterProductChange(queryClient, product),
  });
}

/** Admin: set stock to the counted quantity. */
export function useAdjustStock() {
  const queryClient = useQueryClient();
  return useMutation<Product, Error, { product: Product; countedStock: number }>({
    mutationFn: ({ product, countedStock }) => productsApi.adjustStock(product, countedStock),
    onSuccess: (product) => afterProductChange(queryClient, product),
  });
}

/** Admin: a new product, usually from a barcode the scanner did not recognise. */
export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation<Product, Error, CreateProductInput>({
    mutationFn: (input) => productsApi.create(input),
    onSuccess: (product) => afterProductChange(queryClient, product),
  });
}

/**
 * Any role, within the reasons the server allows that role. The response is a
 * write-off, not a product, so the cached product is decremented locally and
 * re-read in the background.
 */
export function useCreateWriteoff() {
  const queryClient = useQueryClient();
  return useMutation<StockWriteoff, Error, { product: Product; input: CreateStockWriteoffInput }>({
    mutationFn: ({ input }) => stockApi.createWriteoff(input),
    onSuccess: (writeoff, { product }) => {
      afterProductChange(queryClient, { ...product, stock: product.stock - writeoff.quantity });
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.detail(product.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stock.writeoffsAll });
    },
  });
}

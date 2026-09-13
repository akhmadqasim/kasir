import type { Product } from "@kasir/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { primeProduct } from "@/hooks/use-products";
import { productsApi } from "@/lib/api";

export type LookupResult = { code: string; product: Product | null };

/**
 * Barcode first, then SKU.
 *
 * `GET /products/barcode/{code}` is the exact, indexed path a scanner needs.
 * A typed code may be a SKU instead, which only the search endpoint can find;
 * the result is then matched exactly on `sku`/`barcode` so a partial name hit
 * ("12" inside "Indomie 120g") is not mistaken for the product.
 */
export async function lookupProductByCode(code: string): Promise<Product | null> {
  const byBarcode = await productsApi.getByBarcode(code);
  if (byBarcode) return byBarcode;

  const page = await productsApi.search({ query: code, page: 1, per_page: 10 });
  return page.data.find((product) => product.sku === code || product.barcode === code) ?? null;
}

/**
 * Look a code up and put whatever it found into the detail cache.
 *
 * Navigation is deliberately *not* here. The scanner runs inside a modal, and a
 * push that happens while the modal is still on screen lands behind it — so the
 * caller decides when the camera is closed and the detail may open.
 */
export function useProductLookup() {
  const queryClient = useQueryClient();

  return useMutation<LookupResult, Error, string>({
    mutationFn: async (raw) => {
      const code = raw.trim();
      const product = await lookupProductByCode(code);
      if (product) primeProduct(queryClient, product);
      return { code, product };
    },
  });
}

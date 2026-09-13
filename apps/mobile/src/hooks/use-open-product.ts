import type { Product } from "@kasir/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback } from "react";

import { primeProduct } from "@/hooks/use-products";

/**
 * Open a product the list already has.
 *
 * Seeding the detail cache first is what makes the screen paint immediately —
 * there is no `GET /products/{id}` to fall back on — and it is the same step
 * whether the row was drawn by React Native or by SwiftUI, which is why it
 * lives here rather than inside a row component.
 */
export function useOpenProduct(): (product: Product) => void {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useCallback(
    (product: Product) => {
      primeProduct(queryClient, product);
      router.push({ pathname: "/products/[id]", params: { id: String(product.id) } });
    },
    [router, queryClient]
  );
}

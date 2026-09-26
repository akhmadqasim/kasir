import { id, type Product } from "@kasir/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import type { JSX } from "react";

import { ScrollScreen } from "@/components/screen";
import { ErrorView, LoadingView } from "@/components/state-view";

interface ProductGateProps {
  product: UseQueryResult<Product, Error>;
  children: (product: Product) => JSX.Element;
}

/**
 * The loading and error states every product screen shares. A product already
 * on screen stays there when a background re-read fails, rather than the whole
 * screen turning into an error about an item the user is looking at.
 */
export function ProductGate({ product, children }: ProductGateProps): JSX.Element {
  if (product.data) return children(product.data);
  if (product.isError) {
    return (
      <ScrollScreen>
        <ErrorView error={product.error} onRetry={() => void product.refetch()} />
      </ScrollScreen>
    );
  }
  return <LoadingView />;
}

/** What a kasir sees on a screen only an admin may use. */
export function AdminOnlyView(): JSX.Element {
  return (
    <ScrollScreen>
      <Typography color="muted">{id.stock.adjustAdminOnly}</Typography>
    </ScrollScreen>
  );
}

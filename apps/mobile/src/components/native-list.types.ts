import type { Product, User } from "@kasir/shared";

export interface NativeProductListProps {
  products: Product[];
  /** Show "stok / min" instead of the price, for the low-stock list. */
  emphasizeStock: boolean;
  onSelect: (product: Product) => void;
  /** Pull-to-refresh. SwiftUI keeps the spinner up until this settles. */
  onRefresh: () => Promise<unknown>;
  /** Called when the last row appears — the SwiftUI equivalent of `onEndReached`. */
  onEndReached: () => void;
}

export interface NativeSettingsListProps {
  user: User;
  serverAuthority: string;
  appVersion: string;
  onChangeServer: () => void;
  onLogout: () => void;
  isLoggingOut: boolean;
}

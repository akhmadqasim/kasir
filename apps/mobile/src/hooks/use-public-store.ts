import { publicStoreLogoUrl, queryKeys, type PublicStoreInfo } from "@kasir/shared";
import { useQuery } from "@tanstack/react-query";

import { storeApi } from "@/lib/api";
import { useSessionStore } from "@/stores/session-store";

export interface PublicStore {
  /** `null` before onboarding or while the server has not answered. */
  store: PublicStoreInfo | null;
  /** Absolute URL of the logo, or `null` when there is none to show. */
  logoUrl: string | null;
}

/**
 * The shop's name and logo for the login screen, from the same public
 * `GET /store/public` the desktop login reads.
 *
 * Keyed per server, so a phone that just switched desktops never shows the
 * previous shop's name. No retry: a server that cannot answer this cannot log
 * anyone in either, and the login form reports that on the next attempt — the
 * header just falls back to the generic title meanwhile.
 */
export function usePublicStore(): PublicStore {
  const serverOrigin = useSessionStore((state) => state.serverOrigin);
  const { data, dataUpdatedAt } = useQuery({
    queryKey: queryKeys.store.public(serverOrigin ?? ""),
    queryFn: () => storeApi.getPublicStoreInfo(),
    enabled: Boolean(serverOrigin),
    retry: false,
  });

  const store = serverOrigin ? (data ?? null) : null;
  return {
    store,
    // When the slice was fetched busts the image cache, so a replaced logo shows
    // on the next visit rather than whenever the old one expires.
    logoUrl: serverOrigin ? publicStoreLogoUrl(`${serverOrigin}/api`, store, dataUpdatedAt) : null,
  };
}

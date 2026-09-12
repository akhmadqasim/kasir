import {
  createApiClient,
  createAuthApi,
  createProductsApi,
  createStockApi,
  NETWORK_ERROR_MESSAGE,
  ApiError,
} from "@kasir/shared";

import { useSessionStore } from "@/stores/session-store";

/**
 * The one API client of the app, bound to whatever server the session store
 * currently names.
 *
 * `baseUrl` and `headers` read the store on every call, so choosing a
 * different desktop in Pengaturan takes effect on the very next request.
 *
 * The `Origin` header is the whole reason this file exists apart from the
 * shared package: the server rejects a write without an `Origin`/`Referer`
 * matching its own `host:port`, a browser adds it automatically, and React
 * Native's `fetch` does not — but does allow us to set it. See
 * `packages/shared/README.md`.
 */
function requireOrigin(): string {
  const origin = useSessionStore.getState().serverOrigin;
  if (!origin) {
    // Reached only if a screen fires a request before server setup, which the
    // route guard prevents. Failing as a network error keeps it on the same
    // path the UI already handles.
    throw new ApiError("network", NETWORK_ERROR_MESSAGE, 0);
  }
  return origin;
}

export const apiClient = createApiClient({
  baseUrl: () => `${requireOrigin()}/api`,
  headers: () => ({ Origin: requireOrigin() }),
  onUnauthorized: () => {
    // Dropping the user is what sends the router back to the login screen.
    // Nothing navigates directly, so this cannot loop: the login screen makes no
    // authenticated request.
    useSessionStore.getState().clearUser();
  },
});

export const authApi = createAuthApi(apiClient);
export const productsApi = createProductsApi(apiClient);
export const stockApi = createStockApi(apiClient);

import { isApiError } from "@kasir/shared";
import { QueryClient } from "@tanstack/react-query";

/**
 * One retry, and only for failures that a retry can fix. A 4xx is the server
 * saying no; asking again produces the same no, one second later.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (isApiError(error)) return error.code === "network" || error.status >= 500;
  return true;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

import {
  useMutation,
  useQuery,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query"

import type { ApiError } from "@/lib/api/client"

/**
 * The two hooks every screen uses to reach the API.
 *
 * They are deliberately thinner than the `useTauriCommand` pair they replace.
 * That hook took a command name and *derived* the query key from it, which made
 * the key an accident of the transport: rename the command and every
 * invalidation aimed at it stopped matching, with no error anywhere. Here the
 * key is an argument, taken from `queryKeys` in `@/lib/api/query-keys`, and the
 * request is a function from `@/lib/api/<resource>`. Nothing infers anything.
 *
 * The error type is [`ApiError`] rather than `Error`, so a caller can branch on
 * `error.code` — `"validation"` is the cashier's problem, `"internal"` is not —
 * without re-parsing the message it is about to display.
 */

export function useApiQuery<TData>(
  queryKey: QueryKey,
  queryFn: () => Promise<TData>,
  options?: Omit<UseQueryOptions<TData, ApiError, TData, QueryKey>, "queryKey" | "queryFn">,
) {
  return useQuery<TData, ApiError, TData, QueryKey>({
    queryKey,
    queryFn,
    ...options,
  })
}

export function useApiMutation<TData, TVariables = void>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, ApiError, TVariables>, "mutationFn">,
) {
  return useMutation<TData, ApiError, TVariables>({
    mutationFn,
    ...options,
  })
}

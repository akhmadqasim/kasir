import { invoke } from "@tauri-apps/api/core"
import { useQuery, useMutation } from "@tanstack/react-query"
import type { QueryKey, UseQueryOptions, UseMutationOptions } from "@tanstack/react-query"

function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args).catch((err) => {
    throw new Error(typeof err === "string" ? err : String(err))
  })
}

export function useTauriQuery<T>(
  command: string,
  args?: Record<string, unknown>,
  options?: Omit<UseQueryOptions<T>, "queryKey" | "queryFn">
) {
  const queryKey: QueryKey = [command, args]
  return useQuery<T>({
    queryKey,
    queryFn: () => tauriInvoke<T>(command, args),
    ...options,
  })
}

export function useTauriMutation<T, V = Record<string, unknown>>(
  command: string,
  options?: Omit<UseMutationOptions<T, Error, V>, "mutationFn">
) {
  return useMutation<T, Error, V>({
    mutationFn: (args) => tauriInvoke<T>(command, args as Record<string, unknown>),
    ...options,
  })
}

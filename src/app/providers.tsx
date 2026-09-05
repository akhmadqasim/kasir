import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
})

/**
 * React Query is the only provider left. HeroUI needs none — the theme travels
 * on `<html>` as a `light`/`dark` class plus `data-theme`, and its `Tooltip`
 * carries its own context per instance, so the Radix `TooltipProvider` that used
 * to wrap the app went away with the last Radix tooltip.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

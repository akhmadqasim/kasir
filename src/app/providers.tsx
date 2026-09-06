import { QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

import { queryClient } from "./query-client"

/**
 * React Query is the only provider left. HeroUI needs none — the theme travels
 * on `<html>` as a `light`/`dark` class plus `data-theme`, and its `Tooltip`
 * carries its own context per instance, so the Radix `TooltipProvider` that used
 * to wrap the app went away with the last Radix tooltip.
 *
 * The client itself lives in `query-client.ts`, along with the 401 handler that
 * needs it. Importing it here is also what installs that handler.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

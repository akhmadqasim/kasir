import { I18nProvider } from "@heroui/react"
import { QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

import { queryClient } from "./query-client"

/**
 * Two providers. React Query's client lives in `query-client.ts`, along with
 * the 401 handler that needs it; importing it here is also what installs that
 * handler. React Aria's `I18nProvider` pins the locale to `id-ID`: without it
 * every NumberField and date field formats and parses in the webview's own
 * locale, so a typed `25.000` reads as twenty-five on an en-US machine. The
 * theme needs no provider — it travels on `<html>` as a class.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="id-ID">
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nProvider>
  )
}

import { keepPreviousData } from "@tanstack/react-query"

import { useApiQuery } from "@/hooks/use-api"
import {
  getEmoneyDenominations,
  getPaymentPointSearch,
  getPaymentPointSubMenu,
  getPdamProducts,
  getPlnDenominations,
  getPpobMenu,
  getPulsaDetails,
  getTransferChannels,
  getVoucherGroups,
} from "@/lib/api/ppob"
import { queryKeys } from "@/lib/api/query-keys"
import { useDebounce } from "@/hooks/use-debounce"
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants"
import type {
  PpobMenuGroup,
  PulsaDetailsResponse,
  PlnDenom,
  PdamProduct,
  EmoneyDenom,
  PpSearchResult,
  PpSubMenuItem,
  TransferChannelGroup,
  VoucherGroup,
} from "../types"

export function usePpobMenu() {
  return useApiQuery<PpobMenuGroup[]>(queryKeys.ppob.menu, getPpobMenu, {
    staleTime: 300000,
    retry: false,
  })
}

/**
 * Look up the provider and product list for a phone number.
 *
 * Debounced because the query is enabled from ten digits on: an Indonesian
 * mobile number is 11-13 digits, so typing one straight through fired three to
 * four vendor calls for a single lookup. `CLAUDE.md` puts the debounce at 300 ms.
 */
export function usePulsaDetails(phoneNumber: string) {
  const debouncedPhoneNumber = useDebounce(phoneNumber, SEARCH_DEBOUNCE_MS)

  return useApiQuery<PulsaDetailsResponse>(
    queryKeys.ppob.pulsaDetails(debouncedPhoneNumber),
    () => getPulsaDetails(debouncedPhoneNumber),
    {
      enabled: debouncedPhoneNumber.length >= 10,
      staleTime: 60000,
      retry: false,
    },
  )
}

export function usePlnDenom() {
  return useApiQuery<PlnDenom[]>(queryKeys.ppob.plnDenominations, getPlnDenominations, {
    staleTime: 300000,
    retry: false,
  })
}

export function usePdamProducts() {
  return useApiQuery<PdamProduct[]>(queryKeys.ppob.pdamProducts, getPdamProducts, {
    staleTime: 300000,
    retry: false,
  })
}

export function useEmoneyDenom(productId: number) {
  return useApiQuery<EmoneyDenom[]>(
    queryKeys.ppob.emoneyDenominations(productId),
    () => getEmoneyDenominations(productId),
    {
      enabled: productId > 0,
      staleTime: 300000,
      retry: false,
    },
  )
}

export function usePpSubMenu(ppId: number) {
  return useApiQuery<PpSubMenuItem[]>(
    queryKeys.ppob.paymentPointSubMenu(ppId),
    () => getPaymentPointSubMenu(ppId),
    {
      enabled: ppId > 0,
      staleTime: 300000,
      retry: false,
    },
  )
}

/**
 * Search across every payment-point group at once — "Indihome" instead of
 * "pick a category, then scroll for it". Debounced the same 300 ms as every
 * other search box (`CLAUDE.md`); `enabled` only once there is something to
 * search for, so clearing the box does not fire one last empty request.
 *
 * `placeholderData: keepPreviousData` keeps the previous keystroke's results
 * on screen while the next debounced one is in flight — without it, every
 * settled keystroke re-keys the query and the kisi would flash to "Tidak ada
 * layanan" for the gap between requests.
 */
export function usePaymentPointSearch(query: string) {
  const debouncedQuery = useDebounce(query, SEARCH_DEBOUNCE_MS)

  return useApiQuery<PpSearchResult[]>(
    queryKeys.ppob.paymentPointSearch(debouncedQuery),
    () => getPaymentPointSearch(debouncedQuery),
    {
      enabled: debouncedQuery.trim().length > 0,
      placeholderData: keepPreviousData,
      staleTime: 60000,
      retry: false,
    },
  )
}

export function useTransferChannels() {
  return useApiQuery<TransferChannelGroup[]>(queryKeys.ppob.transferChannels, getTransferChannels, {
    staleTime: 300000,
    retry: false,
  })
}

export function useVoucherGroups() {
  return useApiQuery<VoucherGroup[]>(queryKeys.ppob.voucherGroups, getVoucherGroups, {
    staleTime: 300000,
    retry: false,
  })
}

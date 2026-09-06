import { useApiQuery } from "@/hooks/use-api"
import {
  getEmoneyDenominations,
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
    }
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
    }
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
    }
  )
}

export function useTransferChannels() {
  return useApiQuery<TransferChannelGroup[]>(
    queryKeys.ppob.transferChannels,
    getTransferChannels,
    {
      staleTime: 300000,
      retry: false,
    }
  )
}

export function useVoucherGroups() {
  return useApiQuery<VoucherGroup[]>(queryKeys.ppob.voucherGroups, getVoucherGroups, {
    staleTime: 300000,
    retry: false,
  })
}

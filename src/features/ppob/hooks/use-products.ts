import { useTauriQuery } from "@/hooks/use-tauri-command"
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
  return useTauriQuery<PpobMenuGroup[]>("ppob_get_menu", undefined, {
    staleTime: 300000,
    retry: false,
  })
}

/**
 * Look up the provider and product list for a phone number.
 *
 * Debounced because the query is enabled from ten digits on: an Indonesian mobile
 * number is 11-13 digits, so typing one straight through fired three to four
 * vendor calls for a single lookup. `CLAUDE.md` puts the debounce at 300 ms.
 */
export function usePulsaDetails(phoneNumber: string) {
  const debouncedPhoneNumber = useDebounce(phoneNumber, SEARCH_DEBOUNCE_MS)

  return useTauriQuery<PulsaDetailsResponse>(
    "ppob_get_pulsa_details",
    { phoneNumber: debouncedPhoneNumber },
    {
      enabled: debouncedPhoneNumber.length >= 10,
      staleTime: 60000,
      retry: false,
    }
  )
}

export function usePlnDenom() {
  return useTauriQuery<PlnDenom[]>("ppob_get_pln_denom", undefined, {
    staleTime: 300000,
    retry: false,
  })
}

export function usePdamProducts() {
  return useTauriQuery<PdamProduct[]>("ppob_get_pdam_products", undefined, {
    staleTime: 300000,
    retry: false,
  })
}

export function useEmoneyDenom(productId: number) {
  return useTauriQuery<EmoneyDenom[]>(
    "ppob_get_emoney_denom",
    { productId },
    {
      enabled: productId > 0,
      staleTime: 300000,
      retry: false,
    }
  )
}

export function usePpSubMenu(ppId: number) {
  return useTauriQuery<PpSubMenuItem[]>(
    "ppob_get_pp_sub_menu",
    { ppId },
    {
      enabled: ppId > 0,
      staleTime: 300000,
      retry: false,
    }
  )
}

export function useTransferChannels() {
  return useTauriQuery<TransferChannelGroup[]>(
    "ppob_get_transfer_channels",
    undefined,
    {
      staleTime: 300000,
      retry: false,
    }
  )
}

export function useVoucherGroups() {
  return useTauriQuery<VoucherGroup[]>(
    "ppob_get_voucher_groups",
    undefined,
    {
      staleTime: 300000,
      retry: false,
    }
  )
}

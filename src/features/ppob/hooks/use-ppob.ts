import { useTauriQuery, useTauriMutation } from "@/hooks/use-tauri-command"
import type {
  PpobSaldoResponse,
  PpobMenuGroup,
  PulsaProvider,
  PulsaProduct,
  PulsaDetailsResponse,
  PlnDenom,
  PdamProduct,
  EmoneyDenom,
  PpSubMenuItem,
  TransferChannelGroup,
  VoucherGroup,
} from "../types"

export function usePpobSaldo() {
  return useTauriQuery<PpobSaldoResponse>("ppob_get_saldo", undefined, {
    refetchInterval: 60000,
    retry: false,
  })
}

export function usePpobLogin() {
  return useTauriMutation<PpobSaldoResponse>("ppob_login")
}

export function usePpobMenu() {
  return useTauriQuery<PpobMenuGroup[]>("ppob_get_menu", undefined, {
    staleTime: 300000,
    retry: false,
  })
}

export function usePulsaProviders() {
  return useTauriQuery<PulsaProvider[]>("ppob_get_providers", undefined, {
    staleTime: 300000,
    retry: false,
  })
}

export function usePulsaDetails(phoneNumber: string) {
  return useTauriQuery<PulsaDetailsResponse>(
    "ppob_get_pulsa_details",
    { phoneNumber },
    {
      enabled: phoneNumber.length >= 10,
      staleTime: 60000,
      retry: false,
    }
  )
}

export function usePulsaPriceList(providerUid: string) {
  return useTauriQuery<PulsaProduct[]>(
    "ppob_get_pulsa_price_list",
    { providerUid },
    {
      enabled: !!providerUid,
      staleTime: 300000,
      retry: false,
    }
  )
}

export function useDataPriceList(providerUid: string) {
  return useTauriQuery<PulsaProduct[]>(
    "ppob_get_data_price_list",
    { providerUid },
    {
      enabled: !!providerUid,
      staleTime: 300000,
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

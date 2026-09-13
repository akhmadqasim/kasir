export interface PpobMenuGroup {
  id: number
  group: string
  imageUrl: string | null
  pathIcon: string | null
}

export interface PlnDenom {
  id: number
  denom: string
}

export interface PdamProduct {
  id: number
  plu: string
  merchant: string
  igrDesc: string
}

export interface EmoneyDenom {
  id: number
  denom: string
}

export interface PulsaProvider {
  uid: string
  provider: string
  image: string
}

export interface PulsaProduct {
  pulsaProductId: number
  plu: string
  provider: string
  productType: string
  description: string
  productPrice: number
  memberPrice: number
  basePrice: string | number
}

export interface PulsaDetailProduct {
  id: number
  plu: string
  igrPlu: string
  basePrice: number
  vendorPrice: number
  description: string
  isTrouble: number
  promoId: number | null
  nominalCutPrice: number | null
  lastPrice: number | null
  percentage: number | null
}

export interface PulsaDetailsResponse {
  provider: string
  image: string
  products: PulsaDetailProduct[]
}

export interface PpSubMenuItem {
  id: number
  paymentPointGroupId: number
  plu: string
  igrPlu: string
  merchant: string
  description: string
  inputAmt: number
  isTrouble: number
  label: string
  pathIcon: string | null
}

/** The group a `PpSearchResult` was found under — just enough to show and to jump back into it. */
export interface PpSearchGroupRef {
  id: number
  name: string
}

/** One payment-point biller, found by searching across every group's sub-menu at once. */
export interface PpSearchResult {
  id: number
  plu: string
  merchant: string
  description: string
  label: string
  inputAmt: number
  isTrouble: number
  pathIcon: string | null
  group: PpSearchGroupRef
}

export interface TransferChannelDetail {
  channelId: string
  productId: number
  transferType: string
  fee: number
}

export interface TransferChannelGroup {
  channel: string
  details: TransferChannelDetail[]
}

export interface VoucherGroup {
  id: number
  group: string
  icon: string | null
}

import type {
  EmoneyDenom,
  HistoryPaymentItem,
  InquiryResult,
  MutasiItem,
  NotificationListResult,
  PdamProduct,
  PlnDenom,
  PpSearchResult,
  PpSubMenuItem,
  PpobMenuGroup,
  PpobSaldoResponse,
  PulsaDetailsResponse,
  TransferChannelGroup,
  VoucherGroup,
} from "@/features/ppob/types"
import { apiGet, apiPost } from "./client"

/**
 * PPOB: bills, top-ups and the provider's catalogue.
 *
 * Two shapes of request, and the shape says what it costs:
 *
 * * `GET /ppob/catalog/*` — what the provider sells. Cacheable, boring.
 * * `POST /ppob/inquiries/*` — "what does this customer owe?". Reads upstream,
 *   but carries a body and the provider charges for it. Repeating one costs a
 *   query, not money.
 *
 * Nothing here spends money: a PPOB purchase is fulfilled inside
 * `POST /transactions`, never on its own.
 *
 * The parameter casing here is camelCase throughout, because every PPOB struct
 * on the Rust side carries `rename_all = "camelCase"`. That is not true of the
 * report and product endpoints next door, which is why the casing is written
 * out per endpoint rather than assumed.
 */

export function getPpobBalance(): Promise<PpobSaldoResponse> {
  return apiGet<PpobSaldoResponse>("/ppob/balance")
}

export function getPpobMenu(): Promise<PpobMenuGroup[]> {
  return apiGet<PpobMenuGroup[]>("/ppob/menu")
}

/** Authenticate the shop's own account upstream. Admin — it acts on the credentials. */
export function openPpobSession(): Promise<PpobSaldoResponse> {
  return apiPost<PpobSaldoResponse>("/ppob/session")
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export function getPulsaDetails(phoneNumber: string): Promise<PulsaDetailsResponse> {
  return apiGet<PulsaDetailsResponse>("/ppob/catalog/pulsa/details", { phoneNumber })
}

export function getPlnDenominations(): Promise<PlnDenom[]> {
  return apiGet<PlnDenom[]>("/ppob/catalog/pln/denominations")
}

export function getPdamProducts(): Promise<PdamProduct[]> {
  return apiGet<PdamProduct[]>("/ppob/catalog/pdam/products")
}

export function getEmoneyDenominations(productId: number): Promise<EmoneyDenom[]> {
  return apiGet<EmoneyDenom[]>("/ppob/catalog/emoney/denominations", { productId })
}

export function getPaymentPointSubMenu(paymentPointId: number): Promise<PpSubMenuItem[]> {
  return apiGet<PpSubMenuItem[]>(`/ppob/catalog/payment-points/${paymentPointId}/sub-menu`)
}

/**
 * One box, every payment-point group: "Indihome" instead of "pick a
 * category, then scroll for it". The server fetches every group's sub-menu
 * once and keeps the flattened list for 12 hours, so this never fans out to
 * the provider per keystroke.
 */
export function getPaymentPointSearch(query: string): Promise<PpSearchResult[]> {
  return apiGet<PpSearchResult[]>("/ppob/catalog/payment-points/search", { q: query })
}

export function getTransferChannels(): Promise<TransferChannelGroup[]> {
  return apiGet<TransferChannelGroup[]>("/ppob/catalog/transfer/channels")
}

export function getVoucherGroups(): Promise<VoucherGroup[]> {
  return apiGet<VoucherGroup[]>("/ppob/catalog/vouchers/groups")
}

// ---------------------------------------------------------------------------
// Inquiries
// ---------------------------------------------------------------------------

export interface PlnInquiryInput {
  customerId: string
  paymentCode: string
  flagId: string
  amount: number
}

export function plnInquiry(input: PlnInquiryInput): Promise<InquiryResult> {
  return apiPost<InquiryResult>("/ppob/inquiries/pln", input)
}

export interface PdamInquiryInput {
  customerId: string
  productId: number
  paymentCode: string
}

export function pdamInquiry(input: PdamInquiryInput): Promise<InquiryResult> {
  return apiPost<InquiryResult>("/ppob/inquiries/pdam", input)
}

export interface BpjsInquiryInput {
  customerId: string
  phoneNumber: string
  paymentCode: string
  bpjsType: string
  period: string
}

export function bpjsInquiry(input: BpjsInquiryInput): Promise<InquiryResult> {
  return apiPost<InquiryResult>("/ppob/inquiries/bpjs", input)
}

export interface PaymentPointInquiryInput {
  customerId: string
  paymentPointGroupId: number
  productCode?: string
  /** Only for an `inputAmt` biller — the nominal the cashier typed in. */
  amount?: number
}

export function paymentPointInquiry(input: PaymentPointInquiryInput): Promise<InquiryResult> {
  return apiPost<InquiryResult>("/ppob/inquiries/pp", input)
}

export interface EmoneyInquiryInput {
  customerId: string
  productCode: string
}

export function emoneyInquiry(input: EmoneyInquiryInput): Promise<InquiryResult> {
  return apiPost<InquiryResult>("/ppob/inquiries/emoney", input)
}

// ---------------------------------------------------------------------------
// History and notifications
// ---------------------------------------------------------------------------

export function getPpobHistory(startDate: string, endDate: string): Promise<HistoryPaymentItem[]> {
  return apiGet<HistoryPaymentItem[]>("/ppob/history", { startDate, endDate })
}

/**
 * Print a history transaction's struk at `sellPrice` — the Mitra app's
 * "Ringkasan Transaksi" flow, where the outlet sets a "Harga Jual" and then
 * prints. Like every print route, the paper comes out of the till the server
 * runs on.
 */
export function printPpobHistoryReceipt(trxId: string, sellPrice: number): Promise<void> {
  return apiPost<void>(`/ppob/history/${encodeURIComponent(trxId)}/print`, { sellPrice })
}

export function getPpobMutasi(startDate: string, endDate: string): Promise<MutasiItem[]> {
  return apiGet<MutasiItem[]>("/ppob/mutasi", { startDate, endDate })
}

/**
 * The provider's inbox.
 *
 * `forceRefresh` bypasses a five-minute server-side cache. Without it a refresh
 * button re-renders the same list for five minutes; with it, the vendor is
 * called again — which is why it is a deliberate button and not an automatic
 * refetch.
 */
export function getPpobNotifications(
  page: number,
  perPage: number,
  forceRefresh: boolean,
): Promise<NotificationListResult> {
  return apiGet<NotificationListResult>("/ppob/notifications", {
    page,
    perPage,
    forceRefresh,
  })
}

export function markAllPpobNotificationsRead(): Promise<void> {
  return apiPost<void>("/ppob/notifications/read-all")
}

export function markPpobNotificationRead(inboxId: string): Promise<void> {
  return apiPost<void>(`/ppob/notifications/${encodeURIComponent(inboxId)}/read`)
}

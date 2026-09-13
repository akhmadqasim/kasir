import type { HistoryPaymentItem } from "./types"

/**
 * A PLN postpaid row as `/ppob/history` answers it: `total` null, `amount`
 * the figure the outlet paid with the admin fee already in it.
 */
export const PLN_ROW: HistoryPaymentItem = {
  trxId: "111100000001",
  inquiryId: null,
  productName: "-",
  description: "PLN - 231000000002",
  serialNumber: "",
  total: null,
  amount: 73229,
  adminFee: 3500,
  status: "SUKSES",
  createdAt: "2026-09-11 10:11:50",
  vendorPrice: null,
  basePrice: 69729,
  sellPrice: null,
  profit: null,
  margin: null,
  denom: null,
  provider: null,
  merchant: null,
  plu: "321700758",
  serviceType: "PLN",
  customerNo: "231000000002",
  tokenNumber: "",
  paymentCode: "L231000000002-2-260911101150",
  receiptText: "IDPEL          : 231000000002\r\nTOTAL BAYAR    : Rp 73.229,00\r\n",
  invoiceUrl: null,
  igrDesc: "Post paid",
  noRef: "13516345",
}

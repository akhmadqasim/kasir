import { useState } from "react"

import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import { id as t } from "@/i18n/id"
import { printPpobHistoryReceipt } from "@/lib/api/ppob"
import { queryKeys } from "@/lib/api/query-keys"
import { getPpobMarkup } from "@/lib/api/settings"
import { toast } from "@/lib/toast"
import type { HistoryPaymentItem } from "../../types"
import type { PpobMarkup } from "../../types/auth"
import { getDefaultSellPrice, getProviderTotal } from "./history-utils"

/**
 * The struk prints `Total` (what the outlet paid), `Biaya Layanan` and
 * `Grand Total`, so the fee is what the cashier types and the sell price the
 * server wants is derived from it. The fee chosen per transaction is kept for
 * as long as the history table is mounted, so a reprint of the same slip does
 * not start from the default again. Nothing is persisted: the fee lives on
 * the struk, not in the books.
 */
export function useHistoryPrint(item: HistoryPaymentItem | null, onPrinted?: () => void) {
  const trxId = item?.trxId ?? null
  const providerTotal = item ? getProviderTotal(item) : null

  // Only once there is something to price: most visits to the history never
  // print anything.
  const markupQuery = useApiQuery<PpobMarkup>(queryKeys.ppob.markup, getPpobMarkup, {
    enabled: item != null,
    staleTime: 5 * 60_000,
    retry: false,
  })

  // `null` is a cleared field.
  const [fees, setFees] = useState<Record<string, number | null>>({})
  const defaultFee =
    item && providerTotal != null
      ? getDefaultSellPrice(item, providerTotal, markupQuery.data) - providerTotal
      : null
  const fee = trxId != null && trxId in fees ? fees[trxId]! : defaultFee
  const setFee = (value: number | null) => {
    if (trxId != null) setFees((previous) => ({ ...previous, [trxId]: value }))
  }

  // A negative fee is a discount and prints as one; below the cost it would
  // be a struk for money nobody paid — so that, and a cleared field, are
  // both simply "no price", not a price plus a flag saying whether to trust it.
  const rawPrice = fee != null && providerTotal != null ? providerTotal + fee : null
  const sellPrice = rawPrice != null && Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : null

  const print = useApiMutation(() => printPpobHistoryReceipt(trxId ?? "", sellPrice ?? 0), {
    onSuccess: () => {
      toast.success(t.ppob.receiptPrinted)
      onPrinted?.()
    },
    onError: (error) => toast.error(`${t.ppob.receiptPrintFailed}: ${error.message}`),
  })

  return { providerTotal, fee, setFee, sellPrice, print }
}

export type HistoryPrintControl = ReturnType<typeof useHistoryPrint>

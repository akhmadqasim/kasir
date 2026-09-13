import { useState } from "react"

import { useApiMutation } from "@/hooks/use-api"
import { id as t } from "@/i18n/id"
import { printPpobHistoryReceipt } from "@/lib/api/ppob"
import { toast } from "@/lib/toast"
import type { HistoryPaymentItem } from "../../types"
import { getProviderTotal } from "./history-utils"

/**
 * The struk prints `Total` (what the outlet paid), `Biaya Layanan` and
 * `Grand Total`, so the fee is what the cashier types and the sell price the
 * server wants is derived from it. The field starts empty and an empty field
 * is no fee: the struk then shows the cost as the grand total. The fee chosen
 * per transaction is kept for as long as the history table is mounted, so a
 * reprint of the same slip does not start blank again. Nothing is persisted:
 * the fee lives on the struk, not in the books.
 */
export function useHistoryPrint(item: HistoryPaymentItem | null, onPrinted?: () => void) {
  const trxId = item?.trxId ?? null
  const providerTotal = item ? getProviderTotal(item) : null

  // `null` is an empty field.
  const [fees, setFees] = useState<Record<string, number | null>>({})
  const fee = trxId != null ? (fees[trxId] ?? null) : null
  const setFee = (value: number | null) => {
    if (trxId != null) setFees((previous) => ({ ...previous, [trxId]: value }))
  }

  // A negative fee is a discount and prints as one; below the cost it would
  // be a struk for money nobody paid, so that is simply "no price".
  const rawPrice = providerTotal != null ? providerTotal + (fee ?? 0) : null
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

import { Alert } from "@heroui/react"

import { InfoPanel } from "@/components/info-panel"
import { id } from "@/i18n/id"
import type { TransactionDetail, TransactionDetailItem, TransactionItem } from "../types"
import { PpobStatusPanel } from "./ppob-status-panel"

interface TransactionExtraInfoProps {
  detail: TransactionDetail
  ppobItems: TransactionDetailItem[]
  onResolvePpob: (item: TransactionItem, success: boolean) => void
  onCheckPpob: (item: TransactionItem) => void
  /** The PPOB line a status check is running for, if any. */
  checkingPpobId: number | null
  /** Settling a PPOB line by hand is admin-only. */
  isAdmin: boolean
}

/**
 * Notes, the void reason, and one status panel per PPOB line — every PPOB line,
 * not just the first: one cart can hold two PPOB purchases. Renders nothing when
 * there is none of these.
 */
export function TransactionExtraInfo({
  detail,
  ppobItems,
  onResolvePpob,
  onCheckPpob,
  checkingPpobId,
  isAdmin,
}: TransactionExtraInfoProps) {
  const { notes, deleted_reason: deletedReason } = detail.transaction
  if (!notes && !deletedReason && ppobItems.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-foreground">Info Tambahan</h3>
      {notes && (
        <InfoPanel className="flex flex-col gap-1">
          <p className="text-xs">{id.transactions.notes}</p>
          <p className="text-foreground">{notes}</p>
        </InfoPanel>
      )}
      {deletedReason && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Alasan Penghapusan</Alert.Title>
            <Alert.Description>{deletedReason}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {ppobItems.map((item) => (
        <PpobStatusPanel
          key={item.id}
          item={item}
          showName={ppobItems.length > 1}
          checkingId={checkingPpobId}
          isAdmin={isAdmin}
          onCheck={onCheckPpob}
          onResolve={onResolvePpob}
        />
      ))}
    </section>
  )
}

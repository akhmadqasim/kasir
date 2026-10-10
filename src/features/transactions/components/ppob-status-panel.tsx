import { CircleCheck, CircleX, RefreshCw } from "lucide-react"
import { Button, Tooltip } from "@heroui/react"

import { id } from "@/i18n/id"
import { InfoPanel } from "@/components/info-panel"
import { PendingButton } from "@/components/pending-button"
import { formatDateTime, parseBackendDate } from "@/lib/format"
import { isPpobAwaitingBiller, isPpobInFlight, isPpobUncertain } from "@/lib/ppob-status"
import type { TransactionDetailItem, TransactionItem } from "../types"

interface PpobStatusPanelProps {
  item: TransactionDetailItem
  /** Name the line in the heading; needed once a cart holds more than one PPOB line. */
  showName: boolean
  /** Settle an uncertain line by hand, after checking the Mitra history. */
  onResolve: (item: TransactionItem, success: boolean) => void
  /** "Cek status": look an uncertain line up in the Mitra history now. */
  onCheck: (item: TransactionItem) => void
  /** The line a status check is running for, if any. */
  checkingId: number | null
  /** Only an admin may settle a line by hand; the backend refuses a kasir. */
  isAdmin: boolean
  /** "Now" against the server's opening time; a prop so a test can pin it. */
  now?: Date
}

/**
 * Provider message, serial number and — for an uncertain line — "Cek status"
 * plus the settle buttons. An ADVICE line reads as waiting on the biller, not
 * as a problem; neither kind offers a retry or a refund until it is settled.
 *
 * The settle buttons follow the backend guard in `ppob_recovery.rs`: admin
 * only, and "Tandai Gagal" only from `ppob_manual_fail_opens_at` (the server
 * computes it; `null` means no wait). Before that the button stays, disabled,
 * with the time it opens.
 */
export function PpobStatusPanel({
  item,
  showName,
  onResolve,
  onCheck,
  checkingId,
  isAdmin,
  now = new Date(),
}: PpobStatusPanelProps) {
  const uncertain = isPpobUncertain(item.ppob_status)
  const awaitingBiller = isPpobAwaitingBiller(item)
  const isPln = item.service_type === "pln"
  const failOpensAt = parseBackendDate(item.ppob_manual_fail_opens_at)
  const failWaitReason =
    failOpensAt && now < failOpensAt
      ? id.ppobFulfillment.markFailedWaitUntil(formatDateTime(item.ppob_manual_fail_opens_at))
      : null
  const markFailedButton = (
    <Button
      isDisabled={failWaitReason !== null}
      size="sm"
      variant="danger-soft"
      onPress={() => onResolve(item, false)}
    >
      <CircleX />
      {id.ppobFulfillment.markFailed}
    </Button>
  )

  return (
    <InfoPanel className="flex flex-col gap-1">
      <p className="text-xs">
        {id.ppobFulfillment.statusTitle}
        {showName && ` — ${item.product_name}`}
      </p>
      {awaitingBiller && (
        <p className="font-medium text-warning">{id.ppobFulfillment.awaitingBillerTitle(isPln)}</p>
      )}
      {item.ppob_message && <p className="text-foreground">{item.ppob_message}</p>}
      {item.ppob_serial_number && (
        <p className="font-mono text-xs">
          {id.ppobFulfillment.serialNumber(item.ppob_serial_number)}
        </p>
      )}
      {isPpobInFlight(item.ppob_status) && (
        <p className="text-xs">{id.ppobFulfillment.inFlightHint}</p>
      )}
      {uncertain && (
        <>
          <p className="text-xs">
            {awaitingBiller
              ? id.ppobFulfillment.awaitingBillerHint(isPln)
              : id.ppobFulfillment.uncertainCheckHint}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <PendingButton
              isDisabled={checkingId !== null && checkingId !== item.id}
              isPending={checkingId === item.id}
              size="sm"
              variant="primary"
              onPress={() => onCheck(item)}
            >
              <RefreshCw />
              {id.ppobFulfillment.checkStatus}
            </PendingButton>
            {isAdmin && (
              <Button size="sm" variant="secondary" onPress={() => onResolve(item, true)}>
                <CircleCheck />
                {id.ppobFulfillment.markSuccess}
              </Button>
            )}
            {isAdmin &&
              (failWaitReason ? (
                // A disabled button swallows pointer events; the tooltip hangs
                // off a focusable wrapper, as in `RefundButton`.
                <Tooltip>
                  <Tooltip.Trigger className="inline-flex">{markFailedButton}</Tooltip.Trigger>
                  <Tooltip.Content>{failWaitReason}</Tooltip.Content>
                </Tooltip>
              ) : (
                markFailedButton
              ))}
          </div>
          {isAdmin && failWaitReason && <p className="text-xs">{failWaitReason}</p>}
          {!isAdmin && <p className="text-xs">{id.ppobFulfillment.resolveAdminOnly}</p>}
        </>
      )}
    </InfoPanel>
  )
}

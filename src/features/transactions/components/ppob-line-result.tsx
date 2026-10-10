import { Alert, Spinner } from "@heroui/react"
import { RefreshCw } from "lucide-react"

import { PendingButton } from "@/components/pending-button"
import { StatusBadge } from "@/components/status-badge"
import { SummaryList } from "@/components/summary-list"
import { id } from "@/i18n/id"
import {
  isPpobAwaitingBiller,
  isPpobInFlight,
  ppobLineStatusConfig,
  ppobStatusConfig,
} from "@/lib/ppob-status"
import type { TransactionItem } from "../types"

interface PpobLineResultProps {
  line: TransactionItem
  /** "Cek status" for an uncertain line. */
  onCheck: (itemId: number) => void
  /** The line a status check is running for, if any. */
  checkingId: number | null
}

/**
 * What happened upstream to one PPOB line, right after checkout: name and
 * status badge, the token or serial number, and — when it is not a plain
 * success — why, with "Cek status" for an uncertain one. The PPOB page's
 * result dialog and the cashier's success dialog show the same block, so a
 * mixed cart reads exactly like a PPOB-page purchase.
 */
export function PpobLineResult({ line, onCheck, checkingId }: PpobLineResultProps) {
  const status = line.ppob_status ?? "pending"
  const statusConfig = line.ppob_status ? ppobLineStatusConfig(line) : ppobStatusConfig(status)
  const awaitingBiller = isPpobAwaitingBiller(line)
  const isPln = line.service_type === "pln"
  const inFlight = isPpobInFlight(status)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <p className="min-w-0 truncate text-foreground">{line.product_name}</p>
        <span className="flex shrink-0 items-center gap-2">
          {inFlight && <Spinner color="current" size="sm" />}
          {statusConfig && (
            <StatusBadge status={statusConfig.variant}>{statusConfig.label}</StatusBadge>
          )}
        </span>
      </div>

      {line.ppob_serial_number && (
        <SummaryList
          layout="grid"
          items={[{ label: "No. Seri / Token", value: line.ppob_serial_number, tone: "mono" }]}
        />
      )}

      {status === "failed" && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{id.ppobFulfillment.rejectedTitle}</Alert.Title>
            <Alert.Description>
              {line.ppob_message?.trim() || id.ppobFulfillment.rejectedFallback}{" "}
              {id.ppobFulfillment.rejectedHint}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {status === "uncertain" && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              {awaitingBiller
                ? id.ppobFulfillment.awaitingBillerTitle(isPln)
                : id.ppobFulfillment.uncertainTitle}
            </Alert.Title>
            <Alert.Description>
              {awaitingBiller
                ? id.ppobFulfillment.awaitingBillerHint(isPln)
                : id.ppobFulfillment.uncertainHint}
            </Alert.Description>
            <PendingButton
              className="mt-2"
              isDisabled={checkingId !== null && checkingId !== line.id}
              isPending={checkingId === line.id}
              size="sm"
              variant="secondary"
              onPress={() => onCheck(line.id)}
            >
              <RefreshCw />
              {id.ppobFulfillment.checkStatus}
            </PendingButton>
          </Alert.Content>
        </Alert>
      )}
    </div>
  )
}

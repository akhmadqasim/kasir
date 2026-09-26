import { CircleCheck, CircleX } from "lucide-react"
import { Button } from "@heroui/react"

import { id } from "@/i18n/id"
import { InfoPanel } from "@/components/info-panel"
import { isPpobInFlight, isPpobUncertain } from "@/lib/ppob-status"
import type { TransactionItem } from "../types"

interface PpobStatusPanelProps {
  item: TransactionItem
  /** Name the line in the heading; needed once a cart holds more than one PPOB line. */
  showName: boolean
  /** Settle an uncertain line by hand, after checking the Mitra history. */
  onResolve: (item: TransactionItem, success: boolean) => void
}

/** Provider message, serial number and — for an uncertain line — the settle buttons. */
export function PpobStatusPanel({ item, showName, onResolve }: PpobStatusPanelProps) {
  return (
    <InfoPanel className="flex flex-col gap-1">
      <p className="text-xs">
        {id.ppobFulfillment.statusTitle}
        {showName && ` — ${item.product_name}`}
      </p>
      {item.ppob_message && <p className="text-foreground">{item.ppob_message}</p>}
      {item.ppob_serial_number && (
        <p className="font-mono text-xs">
          {id.ppobFulfillment.serialNumber(item.ppob_serial_number)}
        </p>
      )}
      {isPpobInFlight(item.ppob_status) && (
        <p className="text-xs">{id.ppobFulfillment.inFlightHint}</p>
      )}
      {isPpobUncertain(item.ppob_status) && (
        <div className="mt-1 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onPress={() => onResolve(item, true)}>
            <CircleCheck />
            {id.ppobFulfillment.markSuccess}
          </Button>
          <Button size="sm" variant="danger-soft" onPress={() => onResolve(item, false)}>
            <CircleX />
            {id.ppobFulfillment.markFailed}
          </Button>
        </div>
      )}
    </InfoPanel>
  )
}

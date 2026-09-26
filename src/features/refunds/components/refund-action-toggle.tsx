import { ArrowLeftRight, Banknote } from "lucide-react"
import { Label, ToggleButton, ToggleButtonGroup } from "@heroui/react"

import { id } from "@/i18n/id"
import type { ActionType } from "../hooks/use-refund-form"

/** Id label kelompok tipe aksi; `ToggleButtonGroup` tidak punya `Label` sendiri. */
const ACTION_LABEL_ID = "refund-action-type-label"

interface RefundActionToggleProps {
  value: ActionType
  onChange: (value: ActionType) => void
  isDisabled?: boolean
}

/**
 * Pemilih tipe aksi: dua pilihan yang selalu terlihat, satu ketukan di layar
 * sentuh — bukan `Select` yang harus dibuka dulu. React Aria merendernya
 * sebagai radiogroup.
 */
export function RefundActionToggle({ value, onChange, isDisabled }: RefundActionToggleProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label id={ACTION_LABEL_ID}>{id.refund.actionType}</Label>
      <ToggleButtonGroup
        aria-labelledby={ACTION_LABEL_ID}
        className="w-full sm:w-auto sm:self-start"
        disallowEmptySelection
        isDisabled={isDisabled}
        selectedKeys={[value]}
        selectionMode="single"
        onSelectionChange={(keys) => {
          const [picked] = keys
          if (picked === "refund" || picked === "exchange") onChange(picked)
        }}
      >
        <ToggleButton className="flex-1 sm:flex-none" id="refund">
          <Banknote />
          {id.refund.actionRefund}
        </ToggleButton>
        <ToggleButton className="flex-1 sm:flex-none" id="exchange">
          <ToggleButtonGroup.Separator />
          <ArrowLeftRight />
          {id.refund.actionExchange}
        </ToggleButton>
      </ToggleButtonGroup>
    </div>
  )
}

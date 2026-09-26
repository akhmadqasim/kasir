import { useId, useState } from "react"
import type { FormEvent } from "react"
import {
  Form,
  Input,
  Label,
  Modal,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react"
import { ArrowDownCircle, ArrowLeftRight, ArrowUpCircle } from "lucide-react"

import { PendingButton } from "@/components/pending-button"
import { id } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import { errorMessage } from "@/lib/api/client"
import { createCashFlow } from "@/lib/api/shifts"
import { useShiftStore } from "../hooks/use-shift-store"
import { groupDigits, toDigits } from "../utils"

interface CashFlowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CashFlowDialog({ open, onOpenChange }: CashFlowDialogProps) {
  // Held here, not in the form: the backdrop has to know a save is in flight
  // so Escape, a click outside or the close button cannot drop the dialog
  // halfway. The cashier would read that as "not saved" and enter it again.
  const [isSubmitting, setIsSubmitting] = useState(false)

  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(next) => (next || !isSubmitting) && onOpenChange(next)}
    >
      <Modal.Container size="sm">
        <Modal.Dialog aria-label={id.shift.cashFlow.title}>
          {/* React Aria unmounts the dialog as it closes, so every field below
              starts empty on the next open without an effect to reset them. */}
          <CashFlowForm
            isSubmitting={isSubmitting}
            onClose={() => onOpenChange(false)}
            onSubmittingChange={setIsSubmitting}
          />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

interface CashFlowFormProps {
  isSubmitting: boolean
  onSubmittingChange: (isSubmitting: boolean) => void
  /** Closes the dialog after a save, bypassing the in-flight guard on the backdrop. */
  onClose: () => void
}

function CashFlowForm({ isSubmitting, onSubmittingChange, onClose }: CashFlowFormProps) {
  // Starts on "Uang Masuk" so the keyboard path is: type the amount, Enter.
  // The type and the note are one click / one Tab away when they matter.
  const [flowType, setFlowType] = useState<"in" | "out">("in")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const activeShift = useShiftStore((s) => s.activeShift)
  const typeLabelId = useId()

  const numericAmount = Number(amount) || 0
  const canSubmit = numericAmount > 0 && !isSubmitting
  const flowLabel = flowType === "in" ? id.shift.cashIn : id.shift.cashOut

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSubmit) return
    if (!activeShift) {
      // Nothing to book the money against; say so instead of ignoring the press.
      toast.error(id.shift.cashFlowNeedsShift)
      return
    }
    onSubmittingChange(true)
    try {
      await createCashFlow({
        shiftId: activeShift.id,
        flowType,
        amount: numericAmount,
        // The server insists on a note; a blank one becomes the direction.
        description: description.trim() || flowLabel,
      })
      toast.success(id.shift.cashFlowRecorded(flowLabel, formatRupiah(numericAmount)))
      onClose()
    } catch (err) {
      toast.error(id.shift.cashFlowFailed(errorMessage(err)))
    } finally {
      onSubmittingChange(false)
    }
  }

  return (
    // validationBehavior="aria" — see the note in `open-shift-dialog.tsx`.
    <Form validationBehavior="aria" onSubmit={handleSubmit}>
      <Modal.CloseTrigger isDisabled={isSubmitting} />
      <Modal.Header>
        <Modal.Icon className="bg-default text-foreground">
          <ArrowLeftRight className="size-5" />
        </Modal.Icon>
        <Modal.Heading>{id.shift.cashFlow.title}</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <div className="flex flex-col gap-2">
          {/* The visible label names the group; `aria-labelledby` wires it, so
              the word is not a stray `<label>` pointing at nothing. */}
          <Label elementType="span" id={typeLabelId}>
            {id.shift.cashFlow.type}
          </Label>
          {/* `ToggleButtonGroup` pilihan tunggal, seperti contoh "Selection Mode"
              di dokumentasinya — React Aria merendernya sebagai radiogroup, jadi
              pembaca layar tahu ini satu pilihan dari dua. Warna terpilihnya
              bawaan komponen; arah uangnya sudah dibawa ikon dan labelnya. */}
          <ToggleButtonGroup
            aria-labelledby={typeLabelId}
            disallowEmptySelection
            fullWidth
            isDisabled={isSubmitting}
            selectedKeys={[flowType]}
            selectionMode="single"
            onSelectionChange={(keys) => {
              const [picked] = keys
              if (picked === "in" || picked === "out") setFlowType(picked)
            }}
          >
            <ToggleButton id="in">
              <ArrowDownCircle aria-hidden="true" className="text-success" />
              {id.shift.cashFlow.in}
            </ToggleButton>
            <ToggleButton id="out">
              <ToggleButtonGroup.Separator />
              <ArrowUpCircle aria-hidden="true" className="text-danger" />
              {id.shift.cashFlow.out}
            </ToggleButton>
          </ToggleButtonGroup>
        </div>

        <TextField
          autoFocus
          fullWidth
          // Read-only, not disabled, while saving: a disabled field drops focus
          // to <body>, so a failed save would leave no caret to retry from.
          isReadOnly={isSubmitting}
          value={groupDigits(amount)}
          variant="secondary"
          onChange={(value) => setAmount(toDigits(value))}
        >
          <Label>{id.shift.cashFlow.amount}</Label>
          <Input className="text-right tabular-nums" inputMode="numeric" placeholder="0" />
        </TextField>

        <TextField
          fullWidth
          isReadOnly={isSubmitting}
          value={description}
          variant="secondary"
          onChange={setDescription}
        >
          <Label>{id.shift.cashFlow.note}</Label>
          <Input placeholder={id.shift.cashFlow.notePlaceholder} />
        </TextField>
      </Modal.Body>

      <Modal.Footer>
        <PendingButton fullWidth isDisabled={!canSubmit} isPending={isSubmitting} type="submit">
          {id.common.save}
        </PendingButton>
      </Modal.Footer>
    </Form>
  )
}

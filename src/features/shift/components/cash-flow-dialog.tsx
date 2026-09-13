import { useState } from "react"
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
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react"

import { PendingButton } from "@/components/pending-button"
import { id } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import { createCashFlow } from "@/lib/api/shifts"
import { useShiftStore } from "../hooks/use-shift-store"
import { groupDigits, toDigits } from "../utils"

interface CashFlowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CashFlowDialog({ open, onOpenChange }: CashFlowDialogProps) {
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label="Uang Masuk / Keluar">
          {/* React Aria unmounts the dialog as it closes, so every field below
              starts empty on the next open without an effect to reset them. */}
          <CashFlowForm onOpenChange={onOpenChange} />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function CashFlowForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  // Starts on "Uang Masuk" so the keyboard path is: type the amount, Enter.
  // The type and the note are one click / one Tab away when they matter.
  const [flowType, setFlowType] = useState<"in" | "out">("in")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const activeShift = useShiftStore((s) => s.activeShift)

  const numericAmount = Number(amount) || 0
  const canSubmit = numericAmount > 0 && !isSubmitting
  const flowLabel = flowType === "in" ? "Uang masuk" : "Uang keluar"

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSubmit || !activeShift) return
    setIsSubmitting(true)
    try {
      await createCashFlow({
        shiftId: activeShift.id,
        flowType,
        amount: numericAmount,
        // The server insists on a note; a blank one becomes the direction.
        description: description.trim() || flowLabel,
      })
      toast.success(`${flowLabel} ${formatRupiah(numericAmount)} tercatat`)
      onOpenChange(false)
    } catch (err) {
      toast.error(`Gagal mencatat: ${err}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    // validationBehavior="aria" — see the note in `open-shift-dialog.tsx`.
    <Form validationBehavior="aria" onSubmit={handleSubmit}>
      <Modal.CloseTrigger />
      <Modal.Header>
        <Modal.Heading>Uang Masuk / Keluar</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <div className="flex flex-col gap-2">
          <Label>Jenis</Label>
          {/* `ToggleButtonGroup` pilihan tunggal, seperti contoh "Selection Mode"
              di dokumentasinya — React Aria merendernya sebagai radiogroup, jadi
              pembaca layar tahu ini satu pilihan dari dua. Warna terpilihnya
              bawaan komponen; arah uangnya sudah dibawa ikon dan labelnya. */}
          <ToggleButtonGroup
            aria-label="Jenis"
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
              <ArrowDownCircle className="text-success" />
              Uang Masuk
            </ToggleButton>
            <ToggleButton id="out">
              <ToggleButtonGroup.Separator />
              <ArrowUpCircle className="text-danger" />
              Uang Keluar
            </ToggleButton>
          </ToggleButtonGroup>
        </div>

        <TextField
          autoFocus
          fullWidth
          isDisabled={isSubmitting}
          value={groupDigits(amount)}
          variant="secondary"
          onChange={(value) => setAmount(toDigits(value))}
        >
          <Label>Nominal</Label>
          <Input className="text-right tabular-nums" inputMode="numeric" placeholder="0" />
        </TextField>

        <TextField
          fullWidth
          isDisabled={isSubmitting}
          value={description}
          variant="secondary"
          onChange={setDescription}
        >
          <Label>Keterangan (opsional)</Label>
          <Input placeholder="Contoh: Bayar supplier" />
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

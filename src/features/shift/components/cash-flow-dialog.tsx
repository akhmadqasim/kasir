import { useState } from "react"
import type { FormEvent } from "react"
import {
  Button,
  Form,
  Input,
  Label,
  Modal,
  TextField,
  ToggleButton,
} from "@heroui/react"
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react"

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
  const [flowType, setFlowType] = useState<"in" | "out" | "">("")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const activeShift = useShiftStore((s) => s.activeShift)

  const numericAmount = Number(amount) || 0
  const canSubmit =
    flowType !== "" &&
    numericAmount > 0 &&
    description.trim().length > 0 &&
    !isSubmitting

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSubmit || !activeShift) return
    setIsSubmitting(true)
    try {
      await createCashFlow({
        shiftId: activeShift.id,
        flowType,
        amount: numericAmount,
        description: description.trim(),
      })
      const label = flowType === "in" ? "Uang masuk" : "Uang keluar"
      toast.success(`${label} ${formatRupiah(numericAmount)} tercatat`)
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
      <Modal.Header>
        <Modal.Heading>Uang Masuk / Keluar</Modal.Heading>
        <Modal.CloseTrigger />
      </Modal.Header>

      <Modal.Body className="space-y-4">
        <p className="text-sm text-muted">Catat arus kas masuk atau keluar</p>

        <div>
          <Label className="mb-2 block">Jenis</Label>
          {/* `ToggleButton` rather than two plain buttons: the choice is a state,
              and `aria-pressed` is the only way a screen reader can tell which of
              the two is active. Each stays its own tab stop, as before. */}
          <div className="grid w-full grid-cols-2 gap-2">
            <ToggleButton
              className="w-full gap-1.5 data-[selected=true]:bg-success-soft data-[selected=true]:text-success-soft-foreground"
              isDisabled={isSubmitting}
              isSelected={flowType === "in"}
              onChange={() => setFlowType("in")}
            >
              <ArrowDownCircle className="h-4 w-4 text-success" />
              Uang Masuk
            </ToggleButton>
            <ToggleButton
              className="w-full gap-1.5 data-[selected=true]:bg-danger-soft data-[selected=true]:text-danger-soft-foreground"
              isDisabled={isSubmitting}
              isSelected={flowType === "out"}
              onChange={() => setFlowType("out")}
            >
              <ArrowUpCircle className="h-4 w-4 text-danger" />
              Uang Keluar
            </ToggleButton>
          </div>
          {flowType === "" ? (
            <p className="mt-2 text-xs text-muted">
              Pilih jenis arus kas terlebih dahulu.
            </p>
          ) : null}
        </div>

        <TextField
          autoFocus
          fullWidth
          isDisabled={isSubmitting}
          value={groupDigits(amount)}
          onChange={(value) => setAmount(toDigits(value))}
        >
          <Label>Nominal</Label>
          <Input
            className="h-12 text-right text-lg font-bold tabular-nums"
            inputMode="numeric"
            placeholder="0"
          />
        </TextField>

        <TextField
          fullWidth
          isDisabled={isSubmitting}
          value={description}
          onChange={setDescription}
        >
          <Label>Keterangan</Label>
          <Input placeholder="Contoh: Bayar supplier" />
        </TextField>
      </Modal.Body>

      <Modal.Footer>
        <Button
          className="h-12 w-full text-lg font-semibold"
          isDisabled={!canSubmit}
          type="submit"
        >
          {isSubmitting ? "Menyimpan..." : "Simpan"}
        </Button>
      </Modal.Footer>
    </Form>
  )
}

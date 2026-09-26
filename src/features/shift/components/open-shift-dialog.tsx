import { useState } from "react"
import type { FormEvent } from "react"
import { Form, Input, Label, Modal, TextField } from "@heroui/react"
import { Banknote } from "lucide-react"

import { id } from "@/i18n/id"
import { PendingButton } from "@/components/pending-button"
import { errorMessage } from "@/lib/api/client"
import { formatDateTime, formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import { useAuthStore } from "@/features/auth"
import { useShiftStore } from "../hooks/use-shift-store"
import { groupDigits, toDigits } from "../utils"

interface OpenShiftDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OpenShiftDialog({ open, onOpenChange }: OpenShiftDialogProps) {
  // Held here, not in the form, so the backdrop can refuse to close while the
  // shift is being opened — the same guard as `CashFlowDialog`.
  const [isSubmitting, setIsSubmitting] = useState(false)

  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(next) => (next || !isSubmitting) && onOpenChange(next)}
    >
      <Modal.Container size="sm">
        <Modal.Dialog aria-label={id.shift.open.title}>
          {/* React Aria unmounts the dialog as it closes, so the state inside the
              body is rebuilt on every open. The effect that used to clear the
              amount field on `open` is no longer needed. */}
          <OpenShiftForm
            isSubmitting={isSubmitting}
            onClose={() => onOpenChange(false)}
            onSubmittingChange={setIsSubmitting}
          />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

interface OpenShiftFormProps {
  isSubmitting: boolean
  onSubmittingChange: (isSubmitting: boolean) => void
  /** Closes the dialog after the shift opens, bypassing the in-flight guard. */
  onClose: () => void
}

function OpenShiftForm({ isSubmitting, onSubmittingChange, onClose }: OpenShiftFormProps) {
  const [openingCash, setOpeningCash] = useState("")
  const openShift = useShiftStore((s) => s.openShift)
  const user = useAuthStore((s) => s.user)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!user || isSubmitting) return
    onSubmittingChange(true)
    try {
      const cash = openingCash ? Number(openingCash) : undefined
      const { shift, alreadyOpen } = await openShift(cash)
      if (alreadyOpen) {
        // The backend hands back the running shift instead of opening a new one,
        // and the modal awal typed in here is never stored. Say so.
        toast.warning(
          id.shift.alreadyOpen(formatDateTime(shift.openedAt), formatRupiah(shift.openingCash)),
        )
      } else {
        toast.success(id.shift.opened)
      }
      onClose()
    } catch (err) {
      toast.error(id.shift.openFailed(errorMessage(err)))
    } finally {
      onSubmittingChange(false)
    }
  }

  return (
    // validationBehavior="aria" keeps validation out of the browser. With React
    // Aria's default ("native") an invalid field calls setCustomValidity, and the
    // browser then blocks every later submit.
    // Bentuknya persis contoh "Default" di dokumentasi Modal HeroUI — ikon,
    // judul, satu kalimat, tombol penuh — ditambah satu kolom isian. Kalimatnya
    // ada di Body (yang bawaannya sudah `text-sm text-muted`), bukan di
    // Description kolom, supaya tidak ada dua keterangan untuk satu field.
    <Form validationBehavior="aria" onSubmit={handleSubmit}>
      <Modal.CloseTrigger isDisabled={isSubmitting} />
      <Modal.Header>
        <Modal.Icon className="bg-default text-foreground">
          <Banknote className="size-5" />
        </Modal.Icon>
        <Modal.Heading>{id.shift.open.title}</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <p>{id.shift.open.hint}</p>
        <TextField
          autoFocus
          fullWidth
          // Read-only, not disabled, while the request runs: a disabled field
          // drops focus to <body>, and a failed open would leave the cashier
          // without a caret to correct the amount.
          isReadOnly={isSubmitting}
          value={groupDigits(openingCash)}
          variant="secondary"
          onChange={(value) => setOpeningCash(toDigits(value))}
        >
          <Label>{id.shift.open.openingCash}</Label>
          <Input className="text-right tabular-nums" inputMode="numeric" placeholder="0" />
        </TextField>
      </Modal.Body>

      <Modal.Footer>
        <PendingButton fullWidth isPending={isSubmitting} type="submit">
          {id.shift.open.submit}
        </PendingButton>
      </Modal.Footer>
    </Form>
  )
}

import { useState } from "react"
import type { FormEvent } from "react"
import { Button, Description, Form, Input, Label, Modal, TextField } from "@heroui/react"
import { DoorOpen } from "lucide-react"

import { formatDateTime, formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useShiftStore } from "../hooks/use-shift-store"
import { groupDigits, toDigits } from "../utils"

interface OpenShiftDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OpenShiftDialog({ open, onOpenChange }: OpenShiftDialogProps) {
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label="Buka Kasir">
          {/* React Aria unmounts the dialog as it closes, so the state inside the
              body is rebuilt on every open. The effect that used to clear the
              amount field on `open` is no longer needed. */}
          <OpenShiftForm onOpenChange={onOpenChange} />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function OpenShiftForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [openingCash, setOpeningCash] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const openShift = useShiftStore((s) => s.openShift)
  const user = useAuthStore((s) => s.user)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!user || isSubmitting) return
    setIsSubmitting(true)
    try {
      const cash = openingCash ? Number(openingCash) : undefined
      const { shift, alreadyOpen } = await openShift(cash)
      if (alreadyOpen) {
        // The backend hands back the running shift instead of opening a new one,
        // and the modal awal typed in here is never stored. Say so.
        toast.warning(
          `Shift sudah terbuka sejak ${formatDateTime(shift.openedAt)}. Modal awal tetap ${formatRupiah(shift.openingCash)}.`
        )
      } else {
        toast.success("Shift dibuka")
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(`Gagal membuka shift: ${err}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    // validationBehavior="aria" keeps validation out of the browser. With React
    // Aria's default ("native") an invalid field calls setCustomValidity, and the
    // browser then blocks every later submit.
    <Form validationBehavior="aria" onSubmit={handleSubmit}>
      <Modal.Header>
        <Modal.Heading className="flex items-center gap-2">
          <DoorOpen className="h-5 w-5" />
          Buka Kasir
        </Modal.Heading>
        <Modal.CloseTrigger />
      </Modal.Header>

      <Modal.Body className="space-y-3">
        <p className="text-sm text-muted">
          Masukkan jumlah uang awal di laci kasir (opsional), lalu klik Mulai Shift.
        </p>

        <TextField
          autoFocus
          fullWidth
          isDisabled={isSubmitting}
          value={groupDigits(openingCash)}
          onChange={(value) => setOpeningCash(toDigits(value))}
        >
          <Label>Modal Awal (Opsional)</Label>
          <Input
            className="h-12 text-right text-lg font-bold tabular-nums"
            inputMode="numeric"
            placeholder="0"
          />
          <Description>Jumlah uang tunai di laci sebelum mulai berjualan</Description>
        </TextField>
      </Modal.Body>

      <Modal.Footer>
        <Button
          className="h-12 w-full text-lg font-semibold"
          isDisabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Membuka..." : "Mulai Shift"}
        </Button>
      </Modal.Footer>
    </Form>
  )
}

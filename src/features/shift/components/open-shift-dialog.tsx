import { useState } from "react"
import type { FormEvent } from "react"
import { Form, Input, Label, Modal, TextField } from "@heroui/react"
import { Banknote } from "lucide-react"

import { PendingButton } from "@/components/pending-button"
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
          `Shift sudah terbuka sejak ${formatDateTime(shift.openedAt)}. Modal awal tetap ${formatRupiah(shift.openingCash)}.`,
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
    // Bentuknya persis contoh "Default" di dokumentasi Modal HeroUI — ikon,
    // judul, satu kalimat, tombol penuh — ditambah satu kolom isian. Kalimatnya
    // ada di Body (yang bawaannya sudah `text-sm text-muted`), bukan di
    // Description kolom, supaya tidak ada dua keterangan untuk satu field.
    <Form validationBehavior="aria" onSubmit={handleSubmit}>
      <Modal.CloseTrigger />
      <Modal.Header>
        <Modal.Icon className="bg-default text-foreground">
          <Banknote className="size-5" />
        </Modal.Icon>
        <Modal.Heading>Buka Kasir</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <p>Uang tunai di laci saat mulai. Boleh kosong.</p>
        <TextField
          autoFocus
          fullWidth
          isDisabled={isSubmitting}
          value={groupDigits(openingCash)}
          variant="secondary"
          onChange={(value) => setOpeningCash(toDigits(value))}
        >
          <Label>Modal awal</Label>
          <Input className="text-right tabular-nums" inputMode="numeric" placeholder="0" />
        </TextField>
      </Modal.Body>

      <Modal.Footer>
        <PendingButton fullWidth isPending={isSubmitting} type="submit">
          Mulai Shift
        </PendingButton>
      </Modal.Footer>
    </Form>
  )
}

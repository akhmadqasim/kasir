import { useState, type FormEvent } from "react"
import { Button, Form, Input, Label, Modal, TextField } from "@heroui/react"
import { PauseCircle } from "lucide-react"

interface HoldCartDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The name the cart is held under when the field is left empty — shown as
   * the placeholder so the cashier knows what the held cart will be called.
   */
  defaultLabel: string
  /** `label` is what was typed, trimmed; empty when the cashier typed nothing. */
  onHold: (label: string) => void
}

/** "Simpan Transaksi" (F3): park the cart under a customer's name. */
export function HoldCartDialog({ open, onOpenChange, defaultLabel, onHold }: HoldCartDialogProps) {
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label="Simpan Transaksi">
          <Modal.CloseTrigger />
          {/* React Aria melepas isi dialog saat ia menutup, jadi kolom namanya
              selalu kosong lagi setiap kali dibuka. */}
          <HoldCartForm defaultLabel={defaultLabel} onHold={onHold} />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function HoldCartForm({
  defaultLabel,
  onHold,
}: Pick<HoldCartDialogProps, "defaultLabel" | "onHold">) {
  const [label, setLabel] = useState("")

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onHold(label.trim())
  }

  return (
    // A real form: Enter in the field submits once, through the same path as
    // the button, instead of a keydown handler of its own.
    <Form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
      <Modal.Header>
        <Modal.Icon className="bg-default text-foreground">
          <PauseCircle className="size-5" />
        </Modal.Icon>
        <Modal.Heading>Simpan Transaksi</Modal.Heading>
      </Modal.Header>
      <Modal.Body>
        {/* One explanation per dialog (DESIGN.md §5.7): the default name
            lives in this sentence, not in a second Description. */}
        <p>
          Keranjang dikosongkan untuk pelanggan berikutnya dan bisa dibuka lagi lewat Tersimpan
          (F9). Tanpa nama, disimpan sebagai &quot;{defaultLabel}&quot;.
        </p>
        <TextField autoFocus fullWidth value={label} variant="secondary" onChange={setLabel}>
          <Label>Nama pelanggan</Label>
          <Input maxLength={40} placeholder={defaultLabel} />
        </TextField>
      </Modal.Body>
      <Modal.Footer>
        <Button slot="close" type="button" variant="tertiary">
          Batal
        </Button>
        <Button type="submit">Simpan Transaksi</Button>
      </Modal.Footer>
    </Form>
  )
}

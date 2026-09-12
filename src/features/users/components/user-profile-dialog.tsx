import { useState } from "react"
import type { FormEvent } from "react"
import { Button, Form, Modal } from "@heroui/react"

import { InfoPanel } from "@/components/info-panel"
import { PendingButton } from "@/components/pending-button"
import { SummaryList } from "@/components/summary-list"
import { PinInput } from "@/features/auth/components/pin-input"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useChangePin } from "../hooks/use-users"

interface UserProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserProfileDialog({ open, onOpenChange }: UserProfileDialogProps) {
  const user = useAuthStore((s) => s.user)
  const changePin = useChangePin()

  const [currentPin, setCurrentPin] = useState("")
  const [newPin, setNewPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  const resetForm = () => {
    setCurrentPin("")
    setNewPin("")
    setConfirmPin("")
    setErrors({})
  }

  const handleOpenChange = (value: boolean) => {
    if (!value) resetForm()
    onOpenChange(value)
  }

  const validate = () => {
    const newErrors: Record<string, string> = {}

    if (!currentPin) {
      newErrors.currentPin = id.profile.currentPin + " wajib diisi"
    }
    if (!newPin || newPin.length < 4 || newPin.length > 6) {
      newErrors.newPin = id.profile.pinInvalid
    }
    if (newPin !== confirmPin) {
      newErrors.confirmPin = id.profile.pinMismatch
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleChangePin = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!validate() || !user) return

    changePin.mutate(
      { currentPin, newPin },
      {
        onSuccess: () => {
          resetForm()
          onOpenChange(false)
        },
      },
    )
  }

  if (!user) return null

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={handleOpenChange}>
      <Modal.Container scroll="inside" size="sm">
        <Modal.Dialog aria-label={id.profile.title}>
          <Modal.CloseTrigger />
          {/* validationBehavior="aria" keeps validation in this component. With
              React Aria's default ("native") an `isInvalid` field calls
              setCustomValidity, and the browser then blocks every later submit —
              including the one that would clear the error. */}
          <Form
            className="flex min-h-0 flex-1 flex-col"
            validationBehavior="aria"
            onSubmit={handleChangePin}
          >
            <Modal.Header>
              <Modal.Heading>{id.profile.title}</Modal.Heading>
            </Modal.Header>

            <Modal.Body>
              {/* Identitas dibaca saja, jadi `InfoPanel` + `SummaryList` seperti
                  ringkasan di dialog lain; peran ditulis sebagai teks karena ia
                  bukan status (DESIGN.md §5.4). */}
              <InfoPanel>
                <SummaryList
                  layout="grid"
                  items={[
                    { label: id.users.username, value: user.username },
                    { label: id.users.fullName, value: user.full_name },
                    {
                      label: id.users.role,
                      value: user.role === "admin" ? id.users.admin : id.users.kasir,
                    },
                  ]}
                />
              </InfoPanel>

              <h4 className="font-medium text-foreground">{id.profile.changePin}</h4>

              <PinInput
                errorMessage={errors.currentPin}
                isDisabled={changePin.isPending}
                label={id.profile.currentPin}
                value={currentPin}
                variant="secondary"
                onChange={setCurrentPin}
              />
              <PinInput
                errorMessage={errors.newPin}
                isDisabled={changePin.isPending}
                label={id.profile.newPin}
                value={newPin}
                variant="secondary"
                onChange={setNewPin}
              />
              <PinInput
                errorMessage={errors.confirmPin}
                isDisabled={changePin.isPending}
                label={id.profile.confirmNewPin}
                value={confirmPin}
                variant="secondary"
                onChange={setConfirmPin}
              />
            </Modal.Body>

            <Modal.Footer>
              <Button
                isDisabled={changePin.isPending}
                slot="close"
                type="button"
                variant="tertiary"
              >
                {id.users.cancel}
              </Button>
              <PendingButton isPending={changePin.isPending} type="submit">
                {id.users.save}
              </PendingButton>
            </Modal.Footer>
          </Form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

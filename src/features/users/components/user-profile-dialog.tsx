import { useState } from "react"
import type { FormEvent } from "react"
import { Button, Form, Modal } from "@heroui/react"

import { InfoPanel } from "@/components/info-panel"
import { PendingButton } from "@/components/pending-button"
import { SummaryList } from "@/components/summary-list"
import { PinInput, useAuthStore, useChangeOwnPin } from "@/features/auth"
import { id } from "@/i18n/id"
import type { User } from "@/features/auth/types"
import { useFieldErrors } from "@/hooks/use-field-errors"
import { roleLabel } from "@/lib/labels"

type ProfileField = "currentPin" | "newPin" | "confirmPin"

interface UserProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserProfileDialog({ open, onOpenChange }: UserProfileDialogProps) {
  const user = useAuthStore((s) => s.user)

  if (!user) return null

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container scroll="inside" size="sm">
        <Modal.Dialog aria-label={id.profile.title}>
          <Modal.CloseTrigger />
          {/* The form lives in its own component so it mounts with the dialog:
              every open starts with empty PIN fields, however the last one was
              closed (Escape, backdrop, or the parent flipping `open`). */}
          <ProfileForm user={user} onClose={() => onOpenChange(false)} />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function ProfileForm({ user, onClose }: { user: User; onClose: () => void }) {
  const changePin = useChangeOwnPin()

  const [currentPin, setCurrentPin] = useState("")
  const [newPin, setNewPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const { errors, setErrors, edit } = useFieldErrors<ProfileField>()

  const validate = () => {
    const newErrors: Partial<Record<ProfileField, string>> = {}

    if (!currentPin) {
      newErrors.currentPin = id.validation.currentPinRequired
    }
    if (!newPin || newPin.length < 4 || newPin.length > 6) {
      newErrors.newPin = id.validation.pinFormat
    }
    if (newPin !== confirmPin) {
      newErrors.confirmPin = id.validation.newPinMismatch
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleChangePin = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (changePin.isPending || !validate()) return

    changePin.mutate({ currentPin, newPin }, { onSuccess: onClose })
  }

  return (
    // validationBehavior="aria" keeps validation in this component. With React
    // Aria's default ("native") an `isInvalid` field calls setCustomValidity,
    // and the browser then blocks every later submit — including the one that
    // would clear the error.
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
                value: roleLabel(user.role),
              },
            ]}
          />
        </InfoPanel>

        {/* h4: `Modal.Heading` renders React Aria's default h3. */}
        <h4 className="font-medium text-foreground">{id.profile.changePin}</h4>

        <PinInput
          autoFocus
          errorMessage={errors.currentPin}
          isDisabled={changePin.isPending}
          label={id.profile.currentPin}
          value={currentPin}
          variant="secondary"
          onChange={edit("currentPin", setCurrentPin)}
        />
        <PinInput
          description={id.onboarding.pinHint}
          errorMessage={errors.newPin}
          isDisabled={changePin.isPending}
          label={id.profile.newPin}
          value={newPin}
          variant="secondary"
          onChange={edit("newPin", setNewPin)}
        />
        <PinInput
          errorMessage={errors.confirmPin}
          isDisabled={changePin.isPending}
          label={id.profile.confirmNewPin}
          value={confirmPin}
          variant="secondary"
          onChange={edit("confirmPin", setConfirmPin)}
        />
      </Modal.Body>

      <Modal.Footer>
        <Button isDisabled={changePin.isPending} slot="close" type="button" variant="tertiary">
          {id.common.cancel}
        </Button>
        <PendingButton isPending={changePin.isPending} type="submit">
          {id.common.save}
        </PendingButton>
      </Modal.Footer>
    </Form>
  )
}

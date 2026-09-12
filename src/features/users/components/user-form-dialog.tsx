import { useState } from "react"
import type { FormEvent } from "react"
import { Button, FieldError, Form, Input, Label, Modal, TextField } from "@heroui/react"

import { OptionSelect } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import { PinInput } from "@/features/auth/components/pin-input"
import { id } from "@/i18n/id"
import { useCreateUser, useUpdateUser } from "../hooks/use-users"
import type { User } from "@/features/auth/types"

const ROLE_OPTIONS = [
  { key: "admin", label: id.users.admin },
  { key: "kasir", label: id.users.kasir },
] as const

interface UserFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user?: User | null
}

export function UserFormDialog({ open, onOpenChange, user }: UserFormDialogProps) {
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container scroll="inside" size="sm">
        <Modal.Dialog aria-label={user ? id.users.editUser : id.users.addUser}>
          <Modal.CloseTrigger />
          {/* React Aria unmounts the dialog as it closes rather than keeping it
              alive through an exit animation, so the state below starts empty on
              every open — reopening for another user can no longer show the
              previous one's values against the new id. */}
          <UserFormBody user={user} onOpenChange={onOpenChange} />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function UserFormBody({
  user,
  onOpenChange,
}: {
  user?: User | null
  onOpenChange: (open: boolean) => void
}) {
  const isEdit = !!user
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()

  const [username, setUsername] = useState(user?.username ?? "")
  const [fullName, setFullName] = useState(user?.full_name ?? "")
  const [role, setRole] = useState<"admin" | "kasir">(user?.role ?? "kasir")
  const [pin, setPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = () => {
    const newErrors: Record<string, string> = {}

    if (!username.trim()) {
      newErrors.username = id.users.usernameRequired
    }
    if (!fullName.trim()) {
      newErrors.fullName = id.users.fullNameRequired
    }
    if (!isEdit && !pin) {
      newErrors.pin = id.users.pinRequired
    }
    if (pin && (pin.length < 4 || pin.length > 6)) {
      newErrors.pin = id.profile.pinInvalid
    }
    if (pin && pin !== confirmPin) {
      newErrors.confirmPin = id.users.pinMismatch
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!validate()) return

    if (isEdit && user) {
      updateUser.mutate(
        {
          userId: user.id,
          username: username.trim(),
          fullName: fullName.trim(),
          role,
          ...(pin ? { newPin: pin } : {}),
        },
        { onSuccess: () => onOpenChange(false) },
      )
    } else {
      createUser.mutate(
        {
          username: username.trim(),
          fullName: fullName.trim(),
          role,
          pin,
        },
        { onSuccess: () => onOpenChange(false) },
      )
    }
  }

  const isPending = createUser.isPending || updateUser.isPending

  return (
    // validationBehavior="aria" keeps validation in this component. With React
    // Aria's default ("native") an `isInvalid` field calls setCustomValidity, and
    // the browser then blocks every later submit — including the one that would
    // clear the error.
    <Form
      className="flex min-h-0 flex-1 flex-col"
      validationBehavior="aria"
      onSubmit={handleSubmit}
    >
      <Modal.Header>
        <Modal.Heading>{isEdit ? id.users.editUser : id.users.addUser}</Modal.Heading>
      </Modal.Header>

      <Modal.Body>
        <TextField
          fullWidth
          isDisabled={isPending}
          isInvalid={Boolean(errors.username)}
          value={username}
          variant="secondary"
          onChange={setUsername}
        >
          <Label>{id.users.username}</Label>
          <Input placeholder="contoh: kasir01" />
          <FieldError>{errors.username}</FieldError>
        </TextField>

        <TextField
          fullWidth
          isDisabled={isPending}
          isInvalid={Boolean(errors.fullName)}
          value={fullName}
          variant="secondary"
          onChange={setFullName}
        >
          <Label>{id.users.fullName}</Label>
          <Input placeholder="contoh: Ahmad Kasir" />
          <FieldError>{errors.fullName}</FieldError>
        </TextField>

        <OptionSelect
          fullWidth
          isDisabled={isPending}
          label={id.users.role}
          options={ROLE_OPTIONS}
          value={role}
          variant="secondary"
          onChange={(value) => setRole(value === "admin" ? "admin" : "kasir")}
        />

        {/* Satu keterangan per kolom: saat mengubah, `description` sudah
            mengatakan kolomnya boleh kosong, jadi placeholder tidak mengulanginya. */}
        <PinInput
          errorMessage={errors.pin}
          isDisabled={isPending}
          label={isEdit ? id.users.resetPin : id.users.pin}
          description={isEdit ? id.users.resetPinDesc : id.onboarding.pinHint}
          value={pin}
          variant="secondary"
          onChange={setPin}
        />

        {(pin || !isEdit) && (
          <PinInput
            errorMessage={errors.confirmPin}
            isDisabled={isPending}
            label={id.users.confirmPin}
            value={confirmPin}
            variant="secondary"
            onChange={setConfirmPin}
          />
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button isDisabled={isPending} slot="close" type="button" variant="tertiary">
          {id.users.cancel}
        </Button>
        <PendingButton isPending={isPending} type="submit">
          {id.users.save}
        </PendingButton>
      </Modal.Footer>
    </Form>
  )
}

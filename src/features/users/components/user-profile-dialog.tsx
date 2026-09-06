import { useState } from "react"
import type { FormEvent } from "react"
import { Button, Form, Modal, Separator } from "@heroui/react"

import { StatusBadge } from "@/components/status-badge"
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
      }
    )
  }

  if (!user) return null

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={handleOpenChange}>
      <Modal.Container scroll="inside" size="sm">
        <Modal.Dialog aria-label={id.profile.title}>
          {/* validationBehavior="aria" keeps validation in this component. With
              React Aria's default ("native") an `isInvalid` field calls
              setCustomValidity, and the browser then blocks every later submit —
              including the one that would clear the error. */}
          <Form validationBehavior="aria" onSubmit={handleChangePin}>
            <Modal.Header>
              <Modal.Heading>{id.profile.title}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>

            <Modal.Body className="space-y-4">
              <div className="grid grid-cols-[100px_1fr] items-center gap-2 text-sm">
                <span className="text-muted">{id.users.username}</span>
                <span className="font-medium">{user.username}</span>
                <span className="text-muted">{id.users.fullName}</span>
                <span className="font-medium">{user.full_name}</span>
                <span className="text-muted">{id.users.role}</span>
                <StatusBadge
                  className="w-fit"
                  status={user.role === "admin" ? "info" : "neutral"}
                >
                  {user.role === "admin" ? id.users.admin : id.users.kasir}
                </StatusBadge>
              </div>

              <Separator />

              <h4 className="font-medium">{id.profile.changePin}</h4>

              <PinInput
                errorMessage={errors.currentPin}
                isDisabled={changePin.isPending}
                label={id.profile.currentPin}
                value={currentPin}
                onChange={setCurrentPin}
              />
              <PinInput
                errorMessage={errors.newPin}
                isDisabled={changePin.isPending}
                label={id.profile.newPin}
                value={newPin}
                onChange={setNewPin}
              />
              <PinInput
                errorMessage={errors.confirmPin}
                isDisabled={changePin.isPending}
                label={id.profile.confirmNewPin}
                value={confirmPin}
                onChange={setConfirmPin}
              />
            </Modal.Body>

            <Modal.Footer>
              <Button
                isDisabled={changePin.isPending}
                type="button"
                variant="outline"
                onPress={() => handleOpenChange(false)}
              >
                {id.users.cancel}
              </Button>
              <Button isDisabled={changePin.isPending} type="submit">
                {changePin.isPending ? "..." : id.users.save}
              </Button>
            </Modal.Footer>
          </Form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

import { useState } from "react"
import type { FormEvent } from "react"
import { Button, FieldError, Form, Input, Label, TextField } from "@heroui/react"
import { id } from "@/i18n/id"
import { AuthCard } from "@/components/auth-card"
import { PendingButton } from "@/components/pending-button"
import { PinInput } from "@/features/auth/components/pin-input"
import type { SetupAdminInput } from "../types"
import { OnboardingSteps } from "./onboarding-steps"

interface AdminSetupFormProps {
  onSubmit: (data: SetupAdminInput) => void
  onBack: (data: SetupAdminInput) => void
  isLoading: boolean
  initialData?: SetupAdminInput | null
}

export function AdminSetupForm({ onSubmit, onBack, isLoading, initialData }: AdminSetupFormProps) {
  const [fullName, setFullName] = useState(initialData?.full_name ?? "")
  const [username, setUsername] = useState(initialData?.username ?? "")
  const [pin, setPin] = useState(initialData?.pin ?? "")
  const [confirmPin, setConfirmPin] = useState(initialData?.pin ?? "")
  const [errors, setErrors] = useState<Record<string, string>>({})

  const t = id.onboarding

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!fullName.trim()) {
      newErrors.fullName = `${t.fullName} wajib diisi`
    }
    if (!username.trim()) {
      newErrors.username = `${t.username} wajib diisi`
    }
    if (!/^\d{4,6}$/.test(pin)) {
      newErrors.pin = t.pinInvalid
    }
    if (pin !== confirmPin) {
      newErrors.confirmPin = t.pinMismatch
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!validate()) return

    onSubmit({
      full_name: fullName.trim(),
      username: username.trim(),
      pin,
    })
  }

  const currentData: SetupAdminInput = {
    full_name: fullName.trim(),
    username: username.trim(),
    pin,
  }

  return (
    <AuthCard title={t.adminSetup} size="md">
      <OnboardingSteps current="admin" />
      {/* validationBehavior="aria" keeps validation in this component. With
          React Aria's default ("native") an `isInvalid` field calls
          setCustomValidity, and the browser then blocks every later submit —
          including the one that would clear the error. */}
      <Form className="flex flex-col gap-4" validationBehavior="aria" onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            autoFocus
            fullWidth
            isInvalid={Boolean(errors.fullName)}
            isRequired
            value={fullName}
            variant="secondary"
            onChange={setFullName}
          >
            <Label>{t.fullName}</Label>
            <Input />
            <FieldError>{errors.fullName}</FieldError>
          </TextField>
          <TextField
            fullWidth
            isInvalid={Boolean(errors.username)}
            isRequired
            value={username}
            variant="secondary"
            onChange={setUsername}
          >
            <Label>{t.username}</Label>
            <Input />
            <FieldError>{errors.username}</FieldError>
          </TextField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <PinInput
            description={t.pinHint}
            errorMessage={errors.pin}
            label={t.pin}
            value={pin}
            variant="secondary"
            onChange={setPin}
          />
          <PinInput
            errorMessage={errors.confirmPin}
            label={t.confirmPin}
            value={confirmPin}
            variant="secondary"
            onChange={setConfirmPin}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button fullWidth type="button" variant="tertiary" onPress={() => onBack(currentData)}>
            {t.back}
          </Button>
          <PendingButton fullWidth isPending={isLoading} type="submit">
            {t.submit}
          </PendingButton>
        </div>
      </Form>
    </AuthCard>
  )
}

import { useState } from "react"
import type { FormEvent } from "react"
import {
  Button,
  Card,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from "@heroui/react"
import { id } from "@/i18n/id"
import { PinInput } from "@/features/auth/components/pin-input"
import type { SetupAdminInput } from "../types"

interface AdminSetupFormProps {
  onSubmit: (data: SetupAdminInput) => void
  onBack: (data: SetupAdminInput) => void
  isLoading: boolean
  initialData?: SetupAdminInput | null
}

export function AdminSetupForm({
  onSubmit,
  onBack,
  isLoading,
  initialData,
}: AdminSetupFormProps) {
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
    <Card className="grid gap-0 overflow-hidden p-0 md:grid-cols-2">
      <Form className="flex flex-col gap-5 p-6 md:p-8" onSubmit={handleSubmit}>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold">{t.adminSetup}</h1>
          <p className="text-sm text-balance text-muted">
            Buat akun administrator pertama untuk mengelola toko
          </p>
          <p className="text-xs text-muted">{t.step2of2}</p>
        </div>
        <TextField
          autoFocus
          fullWidth
          isInvalid={Boolean(errors.fullName)}
          value={fullName}
          onChange={setFullName}
        >
          <Label>{t.fullName} *</Label>
          <Input />
          <FieldError>{errors.fullName}</FieldError>
        </TextField>
        <TextField
          fullWidth
          isInvalid={Boolean(errors.username)}
          value={username}
          onChange={setUsername}
        >
          <Label>{t.username} *</Label>
          <Input />
          <FieldError>{errors.username}</FieldError>
        </TextField>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-4">
            <PinInput
              errorMessage={errors.pin}
              label={`${t.pin} *`}
              placeholder={t.pinHint}
              value={pin}
              onChange={setPin}
            />
            <PinInput
              errorMessage={errors.confirmPin}
              label={`${t.confirmPin} *`}
              value={confirmPin}
              onChange={setConfirmPin}
            />
          </div>
          {/* HeroUI's Description only renders inside a field context, so this
              hint that spans both PIN columns is a plain paragraph. */}
          <p className="text-sm text-muted">{t.pinHint}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Button
            type="button"
            variant="outline"
            onPress={() => onBack(currentData)}
          >
            {t.back}
          </Button>
          <Button isDisabled={isLoading} type="submit">
            {isLoading ? id.common.loading : t.submit}
          </Button>
        </div>
      </Form>
      <div className="relative hidden bg-default md:block">
        <img
          src="/onboarding-bg.jpg"
          alt="Toko Sembako"
          className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
        />
      </div>
    </Card>
  )
}

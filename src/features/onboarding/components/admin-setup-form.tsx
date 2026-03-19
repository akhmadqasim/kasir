import { useState } from "react"
import type { FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
  FieldError,
} from "@/components/ui/field"
import { id } from "@/i18n/id"
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

  const handleSubmit = (e: FormEvent) => {
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
    <Card className="overflow-hidden p-0">
      <CardContent className="grid p-0 md:grid-cols-2">
        <form className="p-6 md:p-8" onSubmit={handleSubmit}>
          <FieldGroup>
            <div className="flex flex-col items-center gap-2 text-center">
              <h1 className="text-2xl font-bold">{t.adminSetup}</h1>
              <p className="text-sm text-balance text-muted-foreground">
                Buat akun administrator pertama untuk mengelola toko
              </p>
              <p className="text-xs text-muted-foreground">Langkah 2 dari 2</p>
            </div>
            <Field>
              <FieldLabel htmlFor="full-name">{t.fullName} *</FieldLabel>
              <Input
                id="full-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoFocus
              />
              {errors.fullName && <FieldError>{errors.fullName}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="username">{t.username} *</FieldLabel>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              {errors.username && <FieldError>{errors.username}</FieldError>}
            </Field>
            <Field>
              <Field className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="pin">{t.pin} *</FieldLabel>
                  <Input
                    id="pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    placeholder={t.pinHint}
                  />
                  {errors.pin && <FieldError>{errors.pin}</FieldError>}
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirm-pin">
                    {t.confirmPin} *
                  </FieldLabel>
                  <Input
                    id="confirm-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={confirmPin}
                    onChange={(e) =>
                      setConfirmPin(e.target.value.replace(/\D/g, ""))
                    }
                  />
                  {errors.confirmPin && (
                    <FieldError>{errors.confirmPin}</FieldError>
                  )}
                </Field>
              </Field>
              <FieldDescription>4-6 digit angka</FieldDescription>
            </Field>
            <Field className="grid grid-cols-2 gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onBack(currentData)}
              >
                {t.back}
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? id.common.loading : t.submit}
              </Button>
            </Field>
          </FieldGroup>
        </form>
        <div className="relative hidden bg-muted md:block">
          <img
            src="/onboarding-bg.jpg"
            alt="Toko Sembako"
            className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
          />
        </div>
      </CardContent>
    </Card>
  )
}

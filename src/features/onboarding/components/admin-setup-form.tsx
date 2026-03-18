import { useState } from "react"
import type { FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { id } from "@/i18n/id"
import type { SetupAdminInput } from "../types"

interface AdminSetupFormProps {
  onSubmit: (data: SetupAdminInput) => void
  onBack: () => void
  isLoading: boolean
}

export function AdminSetupForm({
  onSubmit,
  onBack,
  isLoading,
}: AdminSetupFormProps) {
  const [fullName, setFullName] = useState("")
  const [username, setUsername] = useState("")
  const [pin, setPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
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

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t.adminSetup}</CardTitle>
        <CardDescription>{t.step2of2}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="full-name">{t.fullName} *</Label>
            <Input
              id="full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
            />
            {errors.fullName && (
              <p className="text-sm text-destructive">{errors.fullName}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">{t.username} *</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            {errors.username && (
              <p className="text-sm text-destructive">{errors.username}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="pin">{t.pin} *</Label>
            <Input
              id="pin"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder={t.pinHint}
            />
            {errors.pin && (
              <p className="text-sm text-destructive">{errors.pin}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-pin">{t.confirmPin} *</Label>
            <Input
              id="confirm-pin"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
            />
            {errors.confirmPin && (
              <p className="text-sm text-destructive">{errors.confirmPin}</p>
            )}
          </div>
        </CardContent>
        <CardFooter className="justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            {t.back}
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? id.common.loading : t.submit}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

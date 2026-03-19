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
import type { SetupStoreInput } from "../types"

interface StoreInfoFormProps {
  onNext: (data: SetupStoreInput) => void
  initialData?: SetupStoreInput | null
}

export function StoreInfoForm({ onNext, initialData }: StoreInfoFormProps) {
  const [name, setName] = useState(initialData?.name ?? "")
  const [address, setAddress] = useState(initialData?.address ?? "")
  const [phone, setPhone] = useState(initialData?.phone ?? "")
  const [email, setEmail] = useState(initialData?.email ?? "")
  const [error, setError] = useState("")

  const t = id.onboarding

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError("")

    if (!name.trim()) {
      setError(`${t.storeName} wajib diisi`)
      return
    }

    onNext({
      name: name.trim(),
      address: address.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
    })
  }

  return (
    <Card className="overflow-hidden p-0">
      <CardContent className="grid p-0 md:grid-cols-2">
        <form className="p-6 md:p-8" onSubmit={handleSubmit}>
          <FieldGroup>
            <div className="flex flex-col items-center gap-2 text-center">
              <h1 className="text-2xl font-bold">{t.storeInfo}</h1>
              <p className="text-sm text-balance text-muted-foreground">
                Lengkapi data toko Anda untuk memulai
              </p>
              <p className="text-xs text-muted-foreground">Langkah 1 dari 2</p>
            </div>
            <Field>
              <FieldLabel htmlFor="store-name">{t.storeName} *</FieldLabel>
              <Input
                id="store-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.storeNamePlaceholder}
                autoFocus
              />
              {error && <FieldError>{error}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="store-address">{t.address}</FieldLabel>
              <Input
                id="store-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <FieldDescription>Akan ditampilkan di struk</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="store-phone">{t.phone}</FieldLabel>
              <Input
                id="store-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="store-email">{t.email}</FieldLabel>
              <Input
                id="store-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
              />
            </Field>
            <Field>
              <Button type="submit" className="w-full">{t.next}</Button>
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

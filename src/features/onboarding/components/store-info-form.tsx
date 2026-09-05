import { useState } from "react"
import type { FormEvent } from "react"
import {
  Button,
  Card,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from "@heroui/react"
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

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
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
    <Card className="grid gap-0 overflow-hidden p-0 md:grid-cols-2">
      <Form className="flex flex-col gap-5 p-6 md:p-8" onSubmit={handleSubmit}>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold">{t.storeInfo}</h1>
          <p className="text-sm text-balance text-muted">
            Lengkapi data toko Anda untuk memulai
          </p>
          <p className="text-xs text-muted">{t.step1of2}</p>
        </div>
        <TextField
          autoFocus
          fullWidth
          isInvalid={Boolean(error)}
          value={name}
          onChange={setName}
        >
          <Label>{t.storeName} *</Label>
          <Input placeholder={t.storeNamePlaceholder} />
          <FieldError>{error}</FieldError>
        </TextField>
        <TextField fullWidth value={address} onChange={setAddress}>
          <Label>{t.address}</Label>
          <Input />
          <Description>Akan ditampilkan di struk</Description>
        </TextField>
        <TextField fullWidth type="tel" value={phone} onChange={setPhone}>
          <Label>{t.phone}</Label>
          <Input />
        </TextField>
        <TextField fullWidth type="email" value={email} onChange={setEmail}>
          <Label>{t.email}</Label>
          <Input />
        </TextField>
        <Button fullWidth type="submit">
          {t.next}
        </Button>
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

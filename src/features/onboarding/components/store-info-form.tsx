import { useState } from "react"
import type { FormEvent } from "react"
import { Button, Description, FieldError, Form, Input, Label, TextField } from "@heroui/react"
import { id } from "@/i18n/id"
import { AuthCard } from "@/components/auth-card"
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
    <AuthCard
      description={
        <>
          Lengkapi data toko Anda untuk memulai.
          <br />
          {t.step1of2}
        </>
      }
      title={t.storeInfo}
    >
      {/* validationBehavior="aria" keeps validation in this component. With
          React Aria's default ("native") an `isInvalid` field calls
          setCustomValidity, and the browser then blocks every later submit —
          including the one that would clear the error. */}
      <Form className="flex flex-col gap-4" validationBehavior="aria" onSubmit={handleSubmit}>
        <TextField
          autoFocus
          fullWidth
          isInvalid={Boolean(error)}
          isRequired
          value={name}
          variant="secondary"
          onChange={setName}
        >
          <Label>{t.storeName}</Label>
          <Input placeholder={t.storeNamePlaceholder} />
          <FieldError>{error}</FieldError>
        </TextField>
        <TextField fullWidth value={address} variant="secondary" onChange={setAddress}>
          <Label>{t.address}</Label>
          <Input />
          <Description>Akan ditampilkan di struk</Description>
        </TextField>
        <TextField fullWidth type="tel" value={phone} variant="secondary" onChange={setPhone}>
          <Label>{t.phone}</Label>
          <Input />
        </TextField>
        <TextField fullWidth type="email" value={email} variant="secondary" onChange={setEmail}>
          <Label>{t.email}</Label>
          <Input />
        </TextField>
        <Button fullWidth type="submit">
          {t.next}
        </Button>
      </Form>
    </AuthCard>
  )
}

import { useRef, useState } from "react"
import type { FormEvent } from "react"
import { Button, Description, FieldError, Form, Input, Label, TextField } from "@heroui/react"
import { id } from "@/i18n/id"
import { AuthCard } from "@/components/auth-card"
import type { SetupStoreInput } from "../types"
import { OnboardingSteps } from "./onboarding-steps"

interface StoreInfoFormProps {
  onNext: (data: SetupStoreInput) => void
  initialData?: SetupStoreInput | null
}

/** Cukup untuk menangkap salah ketik yang jelas (tanpa `@`, tanpa domain); sisanya urusan server. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function StoreInfoForm({ onNext, initialData }: StoreInfoFormProps) {
  const [name, setName] = useState(initialData?.name ?? "")
  const [address, setAddress] = useState(initialData?.address ?? "")
  const [phone, setPhone] = useState(initialData?.phone ?? "")
  const [email, setEmail] = useState(initialData?.email ?? "")
  const [nameError, setNameError] = useState("")
  const [emailError, setEmailError] = useState("")
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  const t = id.onboarding

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    const trimmedEmail = email.trim()
    const nextNameError = name.trim() ? "" : id.validation.storeNameRequired
    const nextEmailError =
      trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail) ? id.validation.invalidEmail : ""
    setNameError(nextNameError)
    setEmailError(nextEmailError)

    // Caret to the first field that needs fixing, in on-screen order.
    if (nextNameError) {
      nameRef.current?.focus()
      return
    }
    if (nextEmailError) {
      emailRef.current?.focus()
      return
    }

    onNext({
      name: name.trim(),
      address: address.trim() || undefined,
      phone: phone.trim() || undefined,
      email: trimmedEmail || undefined,
    })
  }

  return (
    <AuthCard title={t.storeInfo} size="md">
      <OnboardingSteps current="store" />
      {/* validationBehavior="aria" keeps validation in this component. With
          React Aria's default ("native") an `isInvalid` field calls
          setCustomValidity, and the browser then blocks every later submit —
          including the one that would clear the error. */}
      <Form className="flex flex-col gap-4" validationBehavior="aria" onSubmit={handleSubmit}>
        <TextField
          autoFocus
          fullWidth
          isInvalid={Boolean(nameError)}
          isRequired
          value={name}
          variant="secondary"
          onChange={(value) => {
            setName(value)
            setNameError("")
          }}
        >
          <Label>{t.storeName}</Label>
          <Input ref={nameRef} autoComplete="organization" placeholder={t.storeNamePlaceholder} />
          <FieldError>{nameError}</FieldError>
        </TextField>
        <TextField fullWidth value={address} variant="secondary" onChange={setAddress}>
          <Label>{t.address}</Label>
          <Input autoComplete="street-address" />
          <Description>{t.addressHint}</Description>
        </TextField>
        {/* Telepon dan email berdampingan: keduanya pendek, dan barisnya
            menghemat satu tinggi kolom di jendela 1000×500. Di ponsel
            (di bawah `sm`) keduanya bertumpuk supaya tidak terjepit. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField fullWidth type="tel" value={phone} variant="secondary" onChange={setPhone}>
            <Label>{t.phone}</Label>
            <Input autoComplete="tel" inputMode="tel" />
          </TextField>
          <TextField
            fullWidth
            isInvalid={Boolean(emailError)}
            type="email"
            value={email}
            variant="secondary"
            onChange={(value) => {
              setEmail(value)
              setEmailError("")
            }}
          >
            <Label>{t.email}</Label>
            <Input ref={emailRef} autoComplete="email" />
            <FieldError>{emailError}</FieldError>
          </TextField>
        </div>
        <Button fullWidth type="submit">
          {t.next}
        </Button>
      </Form>
    </AuthCard>
  )
}

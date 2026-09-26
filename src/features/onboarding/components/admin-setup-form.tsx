import { useRef, useState } from "react"
import type { FormEvent } from "react"
import { Alert, Button, FieldError, Form, Input, Label, TextField } from "@heroui/react"
import { id } from "@/i18n/id"
import { AuthCard } from "@/components/auth-card"
import { PendingButton } from "@/components/pending-button"
import { useFieldErrors } from "@/hooks/use-field-errors"
import { PinInput } from "@/features/auth"
import type { SetupAdminInput } from "../types"
import { OnboardingSteps } from "./onboarding-steps"

interface AdminSetupFormProps {
  onSubmit: (data: SetupAdminInput) => void
  onBack: (data: SetupAdminInput) => void
  isLoading: boolean
  initialData?: SetupAdminInput | null
  /** Pesan gagal dari server saat mendaftarkan toko; tampil di kartu sampai dikirim ulang. */
  submitError?: string | null
}

type FieldName = "fullName" | "username" | "pin" | "confirmPin"

/** Urutan kolom di layar — fokus pindah ke kolom salah yang pertama menurut urutan ini. */
const FIELD_ORDER: FieldName[] = ["fullName", "username", "pin", "confirmPin"]

export function AdminSetupForm({
  onSubmit,
  onBack,
  isLoading,
  initialData,
  submitError,
}: AdminSetupFormProps) {
  const [fullName, setFullName] = useState(initialData?.full_name ?? "")
  const [username, setUsername] = useState(initialData?.username ?? "")
  const [pin, setPin] = useState(initialData?.pin ?? "")
  // Always blank, even when coming back to this step: seeding it from the PIN
  // would make any typo in the PIN pass its own confirmation.
  const [confirmPin, setConfirmPin] = useState("")
  const { errors, setErrors, clearError } = useFieldErrors<FieldName>()
  // One ref per field, not an object of refs: the React Compiler reads
  // `refs.username` in JSX as a ref being read during render.
  const fullNameRef = useRef<HTMLInputElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)
  const pinRef = useRef<HTMLInputElement>(null)
  const confirmPinRef = useRef<HTMLInputElement>(null)

  const t = id.onboarding

  const validate = (): boolean => {
    const newErrors: Partial<Record<FieldName, string>> = {}

    if (!fullName.trim()) {
      newErrors.fullName = id.validation.fullNameRequired
    }
    if (!username.trim()) {
      newErrors.username = id.validation.usernameRequired
    }
    if (!/^\d{4,6}$/.test(pin)) {
      newErrors.pin = id.validation.pinFormat
    }
    if (pin !== confirmPin) {
      newErrors.confirmPin = id.validation.pinMismatch
    }

    setErrors(newErrors)
    // Put the caret in the first field that needs fixing, so the keyboard user
    // does not have to hunt for the red text.
    const firstInvalid = FIELD_ORDER.find((field) => newErrors[field])
    const inputs = {
      fullName: fullNameRef,
      username: usernameRef,
      pin: pinRef,
      confirmPin: confirmPinRef,
    }
    if (firstInvalid) inputs[firstInvalid].current?.focus()
    return firstInvalid === undefined
  }

  const currentData: SetupAdminInput = {
    full_name: fullName.trim(),
    username: username.trim(),
    pin,
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // Enter in a field submits the form even while the button shows its
    // spinner; without this the store would be registered twice.
    if (isLoading || !validate()) return

    onSubmit(currentData)
  }

  return (
    <AuthCard title={t.adminSetup} size="md">
      <OnboardingSteps current="admin" />
      {/* validationBehavior="aria" keeps validation in this component. With
          React Aria's default ("native") an `isInvalid` field calls
          setCustomValidity, and the browser then blocks every later submit —
          including the one that would clear the error. */}
      <Form className="flex flex-col gap-4" validationBehavior="aria" onSubmit={handleSubmit}>
        {submitError && !isLoading ? (
          <Alert role="alert" status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Toko belum terdaftar</Alert.Title>
              <Alert.Description>{submitError}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        {/* Dua kolom sebaris hanya dari `sm` ke atas: di ponsel 360px dua kolom
            berdampingan menyisakan kurang dari 140px per kolom. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            autoFocus
            fullWidth
            isInvalid={Boolean(errors.fullName)}
            isRequired
            value={fullName}
            variant="secondary"
            onChange={(value) => {
              setFullName(value)
              clearError("fullName")
            }}
          >
            <Label>{t.fullName}</Label>
            <Input ref={fullNameRef} autoComplete="name" />
            <FieldError>{errors.fullName}</FieldError>
          </TextField>
          <TextField
            fullWidth
            isInvalid={Boolean(errors.username)}
            isRequired
            value={username}
            variant="secondary"
            onChange={(value) => {
              setUsername(value)
              clearError("username")
            }}
          >
            <Label>{t.username}</Label>
            <Input
              ref={usernameRef}
              autoCapitalize="none"
              autoComplete="username"
              spellCheck={false}
            />
            <FieldError>{errors.username}</FieldError>
          </TextField>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <PinInput
            autoComplete="new-password"
            description={t.pinHint}
            errorMessage={errors.pin}
            inputRef={pinRef}
            isRequired
            label={t.pin}
            value={pin}
            variant="secondary"
            onChange={(value) => {
              setPin(value)
              clearError("pin")
            }}
          />
          <PinInput
            autoComplete="new-password"
            errorMessage={errors.confirmPin}
            inputRef={confirmPinRef}
            isRequired
            label={t.confirmPin}
            value={confirmPin}
            variant="secondary"
            onChange={(value) => {
              setConfirmPin(value)
              clearError("confirmPin")
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* Nonaktif selagi mendaftar: mundur di tengah permintaan membuat
              langkah pertama tampil lagi padahal tokonya sedang dibuat. */}
          <Button
            fullWidth
            isDisabled={isLoading}
            type="button"
            variant="tertiary"
            onPress={() => onBack(currentData)}
          >
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

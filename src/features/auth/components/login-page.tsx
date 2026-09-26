import { useEffect, useRef, useState } from "react"
import { Alert, Form, Input, Label, TextField } from "@heroui/react"
import { id } from "@/i18n/id"
import { AuthCard, AuthScreen } from "@/components/auth-card"
import { PendingButton } from "@/components/pending-button"
import { useLogin } from "../hooks/use-auth"
import { PinInput } from "./pin-input"
import { useApiQuery } from "@/hooks/use-api"
import { getPublicStoreInfo, publicStoreLogoUrl } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

/**
 * Bentuk kartunya mengikuti `login-demo.tsx` resmi HeroUI lewat `AuthCard`.
 * Yang tersisa di sini hanya formulir dan rantai keyboardnya. Kolom isiannya
 * `variant="secondary"` — DESIGN.md §4.
 *
 * Nama toko (dan logonya, kalau ada) dibaca dari `GET /store/public`, satu-satunya
 * data toko yang boleh diambil sebelum login. Sebelum onboarding jawabannya
 * `null` dan kartu kembali ke judul biasa; pengalihan ke onboarding tetap urusan
 * `AppGuard`.
 */
export function LoginPage() {
  const [username, setUsername] = useState("")
  const [pin, setPin] = useState("")
  const [loginError, setLoginError] = useState<string | null>(null)
  // Bumped on every failed attempt, so the effect below refocuses the PIN
  // even when the same message comes back twice in a row.
  const [failedAttempts, setFailedAttempts] = useState(0)
  const pinRef = useRef<HTMLInputElement>(null)
  const loginMutation = useLogin()
  const { data: store, dataUpdatedAt } = useApiQuery(
    queryKeys.settings.storePublic,
    getPublicStoreInfo,
    { retry: false },
  )

  const t = id.auth
  const isPending = loginMutation.isPending
  const canSubmit = Boolean(username.trim()) && Boolean(pin.trim())

  // A wrong PIN is by far the most common failure: clear it and put the caret
  // back in it, so the cashier simply types again. The fields are read-only
  // (not disabled) while the request runs, which keeps focus where it was.
  useEffect(() => {
    if (failedAttempts > 0) pinRef.current?.focus()
  }, [failedAttempts])

  const submit = () => {
    if (!canSubmit || isPending) return
    setLoginError(null)
    loginMutation.mutate(
      { username: username.trim(), pin },
      {
        onError: (error) => {
          setLoginError(error.message || id.common.error)
          setPin("")
          setFailedAttempts((count) => count + 1)
        },
      },
    )
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    submit()
  }

  return (
    <AuthScreen>
      <AuthCard
        description={store ? t.loginTitle : undefined}
        // When the slice was fetched busts the image cache: a logo replaced
        // since the last visit shows on the next one, not an hour later.
        logoSrc={publicStoreLogoUrl(store, dataUpdatedAt)}
        title={store?.name || t.loginTitle}
      >
        <Form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {/* Pesan gagal duduk di kartu, dekat kolom yang harus diperbaiki —
              bukan toast di pojok layar yang hilang sebelum sempat dibaca.
              `role="alert"` membuat pembaca layar langsung mengumumkannya. */}
          {loginError ? (
            <Alert role="alert" status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{t.loginFailed}</Alert.Title>
                <Alert.Description>{loginError}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <TextField
            autoFocus
            fullWidth
            isReadOnly={isPending}
            type="text"
            value={username}
            variant="secondary"
            onChange={(value) => {
              setUsername(value)
              setLoginError(null)
            }}
          >
            <Label>{t.username}</Label>
            {/*
              Enter di sini turun ke PIN, tidak mengirim formulir. Kasir masuk
              dengan dua tangan di papan ketik dan tidak pernah menekan Tab;
              tanpa ini Enter tidak melakukan apa-apa, karena tombol kirim masih
              nonaktif selama PIN kosong dan browser menolak mengirimkan formulir
              lewat tombol yang nonaktif.
            */}
            <Input
              autoCapitalize="none"
              autoComplete="username"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                pinRef.current?.focus()
              }}
            />
          </TextField>
          {/*
            Enter di PIN memanggil `submit` langsung, tidak menumpang pengiriman
            implisit milik browser. Perilaku implisit itu punya syarat yang mudah
            luput — harus ada tombol submit yang tidak nonaktif — dan menekan
            Enter adalah cara utama kasir masuk, bukan jalan pintas.
          */}
          <PinInput
            autoComplete="current-password"
            inputRef={pinRef}
            isReadOnly={isPending}
            label={t.pin}
            value={pin}
            variant="secondary"
            onChange={(value) => {
              setPin(value)
              setLoginError(null)
            }}
            onEnter={submit}
          />
          <PendingButton fullWidth isDisabled={!canSubmit} isPending={isPending} type="submit">
            {t.loginButton}
          </PendingButton>
        </Form>
      </AuthCard>
    </AuthScreen>
  )
}

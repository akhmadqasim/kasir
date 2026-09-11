import { useRef, useState } from "react"
import { Store } from "lucide-react"
import { Button, Card, Form, Input, Label, Spinner, TextField } from "@heroui/react"
import { id } from "@/i18n/id"
import { useLogin } from "@/features/auth/hooks/use-auth"
import { PinInput } from "@/features/auth/components/pin-input"

/**
 * Satu kartu di tengah layar: merek, judul, dua kolom, satu tombol.
 *
 * Bentuk sebelumnya adalah blok "login-02" shadcn — kartu dua kolom dengan foto
 * toko di sebelah kanan yang disamarkan di mode gelap. Foto itu tidak membawa
 * informasi dan tidak pernah ada di pola HeroUI mana pun; dokumentasi `Form`
 * dan `TextField` HeroUI menyusun formulir sebagai satu kolom sempit di atas
 * satu permukaan, dan itulah yang dipakai di sini.
 *
 * Kolom isian memakai `variant="secondary"` karena berdiri di atas `Card`, yang
 * sudah `bg-surface`; dokumentasi TextField meminta itu supaya kolomnya tidak
 * menyatu dengan latar kartunya.
 */
export function LoginPage() {
  const [username, setUsername] = useState("")
  const [pin, setPin] = useState("")
  const pinRef = useRef<HTMLInputElement>(null)
  const loginMutation = useLogin()

  const t = id.auth
  const canSubmit = Boolean(username.trim()) && Boolean(pin.trim())

  const submit = () => {
    if (!canSubmit || loginMutation.isPending) return
    loginMutation.mutate({ username: username.trim(), pin })
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    submit()
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm gap-6 p-6">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Store className="size-4" />
          </span>
          <span className="text-sm font-medium">{id.app.name}</span>
        </div>

        <Card.Header>
          {/* Judul halaman, bukan judul kartu — jadi bukan `Card.Title`. */}
          <h1 className="text-2xl font-semibold tracking-tight">{t.loginTitle}</h1>
          <Card.Description>{t.loginSubtitle}</Card.Description>
        </Card.Header>

        <Card.Content>
          <Form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <TextField
              autoFocus
              fullWidth
              isDisabled={loginMutation.isPending}
              type="text"
              value={username}
              variant="secondary"
              onChange={setUsername}
            >
              <Label>{t.username}</Label>
              {/*
                Enter di sini turun ke PIN, tidak mengirim formulir. Kasir masuk
                dengan dua tangan di papan ketik dan tidak pernah menekan Tab;
                tanpa ini Enter tidak melakukan apa-apa, karena tombol kirim
                masih nonaktif selama PIN kosong dan browser menolak mengirimkan
                formulir lewat tombol yang nonaktif.
              */}
              <Input
                placeholder={t.username}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  pinRef.current?.focus()
                }}
              />
            </TextField>
            {/*
              Enter di PIN memanggil `submit` langsung, tidak menumpang pengiriman
              implisit milik browser. Perilaku implisit itu punya syarat yang
              mudah luput — harus ada tombol submit yang tidak nonaktif — dan
              menekan Enter adalah cara utama kasir masuk, bukan jalan pintas.
            */}
            <PinInput
              inputRef={pinRef}
              isDisabled={loginMutation.isPending}
              label={t.pin}
              placeholder={t.pin}
              value={pin}
              variant="secondary"
              onChange={setPin}
              onEnter={submit}
            />
            <Button
              fullWidth
              isDisabled={!canSubmit}
              isPending={loginMutation.isPending}
              type="submit"
            >
              {({ isPending }) => (
                <>
                  {isPending ? <Spinner color="current" size="sm" /> : null}
                  {t.loginButton}
                </>
              )}
            </Button>
          </Form>
        </Card.Content>
      </Card>
    </div>
  )
}

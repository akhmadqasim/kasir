import { useState } from "react"
import { Store } from "lucide-react"
import { Button, Card, Form, Input, Label, TextField } from "@heroui/react"
import { id } from "@/i18n/id"
import { useLogin } from "@/features/auth/hooks/use-auth"
import { PinInput } from "@/features/auth/components/pin-input"

export function LoginPage() {
  const [username, setUsername] = useState("")
  const [pin, setPin] = useState("")
  const loginMutation = useLogin()

  const t = id.auth
  const canSubmit = Boolean(username.trim()) && Boolean(pin.trim())

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSubmit) return
    loginMutation.mutate({ input: { username: username.trim(), pin } })
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-default p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-4xl">
        <Card className="grid gap-0 overflow-hidden p-0 md:grid-cols-2">
          <Form
            className="flex flex-col gap-5 p-6 md:p-8"
            onSubmit={handleSubmit}
          >
            <div className="flex items-center gap-2 self-center">
              <div className="flex size-6 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <Store className="size-4" />
              </div>
              <span className="font-medium">{id.app.name}</span>
            </div>
            <div className="flex flex-col items-center gap-2 text-center">
              <h1 className="text-2xl font-bold">{t.loginTitle}</h1>
              <p className="text-sm text-balance text-muted">
                {t.loginSubtitle}
              </p>
            </div>
            <TextField
              autoFocus
              fullWidth
              isDisabled={loginMutation.isPending}
              type="text"
              value={username}
              onChange={setUsername}
            >
              <Label>{t.username}</Label>
              <Input placeholder={t.username} />
            </TextField>
            <PinInput
              isDisabled={loginMutation.isPending}
              label={t.pin}
              placeholder={t.pin}
              value={pin}
              onChange={setPin}
            />
            <Button
              fullWidth
              isDisabled={loginMutation.isPending || !canSubmit}
              type="submit"
            >
              {loginMutation.isPending ? id.common.loading : t.loginButton}
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
      </div>
    </div>
  )
}

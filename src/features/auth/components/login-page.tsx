import { useState } from "react"
import { Store } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { id } from "@/i18n/id"
import { useLogin } from "@/features/auth/hooks/use-auth"
import { PinInput } from "@/features/auth/components/pin-input"

export function LoginPage() {
  const [username, setUsername] = useState("")
  const [pin, setPin] = useState("")
  const loginMutation = useLogin()

  const t = id.auth

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !pin.trim()) return
    loginMutation.mutate({ input: { username: username.trim(), pin } })
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-default p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-4xl">
        <Card className="overflow-hidden p-0">
          <CardContent className="grid p-0 md:grid-cols-2">
            <form className="p-6 md:p-8" onSubmit={handleSubmit}>
              <FieldGroup>
                <div className="flex items-center gap-2 self-center">
                  <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <Store className="size-4" />
                  </div>
                  <span className="font-medium">{id.app.name}</span>
                </div>
                <div className="flex flex-col items-center gap-2 text-center">
                  <h1 className="text-2xl font-bold">{t.loginTitle}</h1>
                  <p className="text-sm text-balance text-muted-foreground">
                    {t.loginSubtitle}
                  </p>
                </div>
                <Field>
                  <FieldLabel htmlFor="username">{t.username}</FieldLabel>
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t.username}
                    disabled={loginMutation.isPending}
                    autoFocus
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pin">{t.pin}</FieldLabel>
                  <PinInput
                    id="pin"
                    value={pin}
                    onChange={setPin}
                    placeholder={t.pin}
                    disabled={loginMutation.isPending}
                  />
                </Field>
                <Field>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={
                      loginMutation.isPending ||
                      !username.trim() ||
                      !pin.trim()
                    }
                  >
                    {loginMutation.isPending
                      ? id.common.loading
                      : t.loginButton}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
            <div className="relative hidden bg-default md:block">
              <img
                src="/onboarding-bg.jpg"
                alt="Toko Sembako"
                className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

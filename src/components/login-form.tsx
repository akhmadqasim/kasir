import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { id } from "@/i18n/id"
import { useLogin } from "@/features/auth/hooks/use-auth"
import { PinInput } from "@/features/auth/components/pin-input"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"form">) {
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
    <form
      onSubmit={handleSubmit}
      className={cn("flex flex-col gap-6", className)}
      {...props}
    >
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
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
            disabled={loginMutation.isPending || !username.trim() || !pin.trim()}
          >
            {loginMutation.isPending ? id.common.loading : t.loginButton}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

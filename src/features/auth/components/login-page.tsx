import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { id } from "@/i18n/id"
import { useLogin } from "../hooks/use-auth"
import { PinInput } from "./pin-input"

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-6 px-4">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">{id.app.name}</h1>
          <p className="text-muted-foreground">{t.loginSubtitle}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t.loginTitle}</CardTitle>
            <CardDescription>{t.loginSubtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t.username}</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t.username}
                  disabled={loginMutation.isPending}
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pin">{t.pin}</Label>
                <PinInput
                  id="pin"
                  value={pin}
                  onChange={setPin}
                  placeholder={t.pin}
                  disabled={loginMutation.isPending}
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loginMutation.isPending || !username.trim() || !pin.trim()}
              >
                {loginMutation.isPending ? id.common.loading : t.loginButton}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

import { useState } from "react"
import type { FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { id } from "@/i18n/id"
import type { SetupStoreInput } from "../types"

interface StoreInfoFormProps {
  onNext: (data: SetupStoreInput) => void
}

export function StoreInfoForm({ onNext }: StoreInfoFormProps) {
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")

  const t = id.onboarding

  const handleSubmit = (e: FormEvent) => {
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
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t.storeInfo}</CardTitle>
        <CardDescription>{t.step1of2}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="store-name">{t.storeName} *</Label>
            <Input
              id="store-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.storeNamePlaceholder}
              autoFocus
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-address">{t.address}</Label>
            <Input
              id="store-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-phone">{t.phone}</Label>
            <Input
              id="store-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-email">{t.email}</Label>
            <Input
              id="store-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
            />
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit">{t.next}</Button>
        </CardFooter>
      </form>
    </Card>
  )
}

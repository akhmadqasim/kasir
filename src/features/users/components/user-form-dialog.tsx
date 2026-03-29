import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PinInput } from "@/features/auth/components/pin-input"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useCreateUser, useUpdateUser } from "../hooks/use-users"
import type { User } from "@/features/auth/types"

interface UserFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user?: User | null
}

export function UserFormDialog({ open, onOpenChange, user }: UserFormDialogProps) {
  const isEdit = !!user
  const currentUser = useAuthStore((s) => s.user)
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()

  const [username, setUsername] = useState("")
  const [fullName, setFullName] = useState("")
  const [role, setRole] = useState<"admin" | "kasir">("kasir")
  const [pin, setPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) {
      if (user) {
        setUsername(user.username)
        setFullName(user.full_name)
        setRole(user.role)
      } else {
        setUsername("")
        setFullName("")
        setRole("kasir")
      }
      setPin("")
      setConfirmPin("")
      setErrors({})
    }
  }, [open, user])

  const validate = () => {
    const newErrors: Record<string, string> = {}

    if (!username.trim()) {
      newErrors.username = id.users.usernameRequired
    }
    if (!fullName.trim()) {
      newErrors.fullName = id.users.fullNameRequired
    }
    if (!isEdit && !pin) {
      newErrors.pin = id.users.pinRequired
    }
    if (pin && (pin.length < 4 || pin.length > 6)) {
      newErrors.pin = id.profile.pinInvalid
    }
    if (pin && pin !== confirmPin) {
      newErrors.confirmPin = id.users.pinMismatch
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return

    if (isEdit && user) {
      updateUser.mutate(
        {
          input: {
            userId: user.id,
            username: username.trim(),
            fullName: fullName.trim(),
            role,
            ...(pin ? { newPin: pin } : {}),
          },
          callerId: currentUser!.id,
        },
        { onSuccess: () => onOpenChange(false) }
      )
    } else {
      createUser.mutate(
        {
          input: {
            username: username.trim(),
            fullName: fullName.trim(),
            role,
            pin,
          },
          callerId: currentUser!.id,
        },
        { onSuccess: () => onOpenChange(false) }
      )
    }
  }

  const isPending = createUser.isPending || updateUser.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? id.users.editUser : id.users.addUser}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">{id.users.username}</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="contoh: kasir01"
              disabled={isPending}
            />
            {errors.username && (
              <p className="text-sm text-destructive">{errors.username}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">{id.users.fullName}</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="contoh: Ahmad Kasir"
              disabled={isPending}
            />
            {errors.fullName && (
              <p className="text-sm text-destructive">{errors.fullName}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{id.users.role}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "admin" | "kasir")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{id.users.admin}</SelectItem>
                <SelectItem value="kasir">{id.users.kasir}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pin">
              {isEdit ? id.users.resetPin : id.users.pin}
            </Label>
            {isEdit && (
              <p className="text-xs text-muted-foreground">{id.users.resetPinDesc}</p>
            )}
            <PinInput
              id="pin"
              value={pin}
              onChange={setPin}
              placeholder={isEdit ? "Kosongkan jika tidak diubah" : "4-6 digit"}
              disabled={isPending}
            />
            {errors.pin && (
              <p className="text-sm text-destructive">{errors.pin}</p>
            )}
          </div>

          {(pin || !isEdit) && (
            <div className="space-y-2">
              <Label htmlFor="confirmPin">{id.users.confirmPin}</Label>
              <PinInput
                id="confirmPin"
                value={confirmPin}
                onChange={setConfirmPin}
                placeholder="Ulangi PIN"
                disabled={isPending}
              />
              {errors.confirmPin && (
                <p className="text-sm text-destructive">{errors.confirmPin}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {id.users.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "..." : id.users.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

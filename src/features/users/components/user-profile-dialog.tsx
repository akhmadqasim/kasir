import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { PinInput } from "@/features/auth/components/pin-input"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useChangePin } from "../hooks/use-users"

interface UserProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserProfileDialog({ open, onOpenChange }: UserProfileDialogProps) {
  const user = useAuthStore((s) => s.user)
  const changePin = useChangePin()

  const [currentPin, setCurrentPin] = useState("")
  const [newPin, setNewPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  const resetForm = () => {
    setCurrentPin("")
    setNewPin("")
    setConfirmPin("")
    setErrors({})
  }

  const handleOpenChange = (value: boolean) => {
    if (!value) resetForm()
    onOpenChange(value)
  }

  const validate = () => {
    const newErrors: Record<string, string> = {}

    if (!currentPin) {
      newErrors.currentPin = id.profile.currentPin + " wajib diisi"
    }
    if (!newPin || newPin.length < 4 || newPin.length > 6) {
      newErrors.newPin = id.profile.pinInvalid
    }
    if (newPin !== confirmPin) {
      newErrors.confirmPin = id.profile.pinMismatch
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleChangePin = () => {
    if (!validate() || !user) return

    changePin.mutate(
      { userId: user.id, currentPin, newPin },
      {
        onSuccess: () => {
          resetForm()
          onOpenChange(false)
        },
      }
    )
  }

  if (!user) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{id.profile.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
            <span className="text-muted-foreground">{id.users.username}</span>
            <span className="font-medium">{user.username}</span>
            <span className="text-muted-foreground">{id.users.fullName}</span>
            <span className="font-medium">{user.full_name}</span>
            <span className="text-muted-foreground">{id.users.role}</span>
            <Badge variant="outline" className="w-fit capitalize">
              {user.role === "admin" ? id.users.admin : id.users.kasir}
            </Badge>
          </div>

          <Separator />

          <h4 className="font-medium">{id.profile.changePin}</h4>

          <div className="space-y-2">
            <Label htmlFor="currentPin">{id.profile.currentPin}</Label>
            <PinInput
              id="currentPin"
              value={currentPin}
              onChange={setCurrentPin}
              isDisabled={changePin.isPending}
            />
            {errors.currentPin && (
              <p className="text-sm font-medium text-destructive">{errors.currentPin}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPin">{id.profile.newPin}</Label>
            <PinInput
              id="newPin"
              value={newPin}
              onChange={setNewPin}
              isDisabled={changePin.isPending}
            />
            {errors.newPin && (
              <p className="text-sm font-medium text-destructive">{errors.newPin}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmNewPin">{id.profile.confirmNewPin}</Label>
            <PinInput
              id="confirmNewPin"
              value={confirmPin}
              onChange={setConfirmPin}
              isDisabled={changePin.isPending}
            />
            {errors.confirmPin && (
              <p className="text-sm font-medium text-destructive">{errors.confirmPin}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={changePin.isPending}>
            {id.users.cancel}
          </Button>
          <Button onClick={handleChangePin} disabled={changePin.isPending}>
            {changePin.isPending ? "..." : id.users.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

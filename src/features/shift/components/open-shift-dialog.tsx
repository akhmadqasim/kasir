import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DoorOpen } from "lucide-react"
import { useShiftStore } from "../hooks/use-shift-store"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"

interface OpenShiftDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OpenShiftDialog({ open, onOpenChange }: OpenShiftDialogProps) {
  const [openingCash, setOpeningCash] = useState("")
  const [displayCash, setDisplayCash] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const openShift = useShiftStore((s) => s.openShift)
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (open) {
      setOpeningCash("")
      setDisplayCash("")
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const formatNumber = (num: number): string =>
    new Intl.NumberFormat("id-ID").format(num)

  const handleCashChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "")
    if (raw === "") {
      setOpeningCash("")
      setDisplayCash("")
      return
    }
    const num = Number(raw)
    setOpeningCash(String(num))
    setDisplayCash(formatNumber(num))
  }

  const handleSubmit = async () => {
    if (!user) return
    setIsSubmitting(true)
    try {
      const cash = openingCash ? Number(openingCash) : undefined
      await openShift(user.id, cash)
      toast.success("Shift dibuka")
      onOpenChange(false)
    } catch (err) {
      toast.error(`Gagal membuka shift: ${err}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DoorOpen className="h-5 w-5" />
            Buka Kasir
          </DialogTitle>
          <DialogDescription>
            Masukkan jumlah uang awal di laci kasir (opsional), lalu klik Mulai Shift.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="opening-cash">Modal Awal (Opsional)</Label>
            <Input
              ref={inputRef}
              id="opening-cash"
              type="text"
              inputMode="numeric"
              className="mt-1 !h-12 !text-lg !font-bold text-right tabular-nums"
              placeholder="0"
              value={displayCash}
              onChange={handleCashChange}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Jumlah uang tunai di laci sebelum mulai berjualan
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            className="h-12 w-full text-lg font-semibold"
            disabled={isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting ? "Membuka..." : "Mulai Shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

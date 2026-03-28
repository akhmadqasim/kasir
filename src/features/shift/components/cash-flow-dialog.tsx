import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react"
import { useShiftStore } from "../hooks/use-shift-store"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { CashFlow } from "../types"

interface CashFlowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CashFlowDialog({ open, onOpenChange }: CashFlowDialogProps) {
  const [flowType, setFlowType] = useState<"in" | "out">("out")
  const [amount, setAmount] = useState("")
  const [displayAmount, setDisplayAmount] = useState("")
  const [description, setDescription] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)
  const activeShift = useShiftStore((s) => s.activeShift)
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (open) {
      setFlowType("out")
      setAmount("")
      setDisplayAmount("")
      setDescription("")
      setTimeout(() => amountRef.current?.focus(), 100)
    }
  }, [open])

  const formatNumber = (num: number): string =>
    new Intl.NumberFormat("id-ID").format(num)

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "")
    if (raw === "") {
      setAmount("")
      setDisplayAmount("")
      return
    }
    const num = Number(raw)
    setAmount(String(num))
    setDisplayAmount(formatNumber(num))
  }

  const numericAmount = Number(amount) || 0
  const canSubmit =
    numericAmount > 0 && description.trim().length > 0 && !isSubmitting

  const handleSubmit = async () => {
    if (!canSubmit || !activeShift || !user) return
    setIsSubmitting(true)
    try {
      await invoke<CashFlow>("create_cash_flow", {
        input: {
          shiftId: activeShift.id,
          userId: user.id,
          flowType,
          amount: numericAmount,
          description: description.trim(),
        },
      })
      const label = flowType === "in" ? "Uang masuk" : "Uang keluar"
      toast.success(`${label} Rp ${formatNumber(numericAmount)} tercatat`)
      onOpenChange(false)
    } catch (err) {
      toast.error(`Gagal mencatat: ${err}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canSubmit) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>Uang Masuk / Keluar</DialogTitle>
          <DialogDescription>
            Catat arus kas masuk atau keluar
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Jenis</Label>
            <Tabs
              value={flowType}
              onValueChange={(v) => setFlowType(v as "in" | "out")}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="in" className="gap-1.5">
                  <ArrowDownCircle className="h-4 w-4 text-green-600" />
                  Uang Masuk
                </TabsTrigger>
                <TabsTrigger value="out" className="gap-1.5">
                  <ArrowUpCircle className="h-4 w-4 text-red-500" />
                  Uang Keluar
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div>
            <Label htmlFor="cf-amount">Nominal</Label>
            <Input
              ref={amountRef}
              id="cf-amount"
              type="text"
              inputMode="numeric"
              className="mt-1 !h-12 !text-lg !font-bold text-right tabular-nums"
              placeholder="0"
              value={displayAmount}
              onChange={handleAmountChange}
            />
          </div>

          <div>
            <Label htmlFor="cf-desc">Keterangan</Label>
            <Input
              id="cf-desc"
              className="mt-1"
              placeholder="Contoh: Bayar supplier"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            className="h-12 w-full text-lg font-semibold"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {isSubmitting ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ArrowDownCircle,
  ArrowLeft,
  ArrowUpCircle,
  Banknote,
  CreditCard,
  Loader2,
  Receipt,
  ShoppingBag,
  User,
  Wallet,
} from "lucide-react"
import { useShiftStore } from "../hooks/use-shift-store"
import type { ShiftSummary } from "../types"

function formatRp(n: number): string {
  return `Rp ${new Intl.NumberFormat("id-ID").format(Math.round(n))}`
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr + "Z")
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  ewallet: "E-Wallet",
  transfer: "Transfer Bank",
}

function paymentLabel(method: string): string {
  return PAYMENT_LABELS[method] ?? method
}

export function CloseShiftPage() {
  const navigate = useNavigate()
  const [closingCash, setClosingCash] = useState("")
  const [displayCash, setDisplayCash] = useState("")
  const [notes, setNotes] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeShift = useShiftStore((s) => s.activeShift)
  const clearShift = useShiftStore((s) => s.clearShift)

  useEffect(() => {
    if (!activeShift) {
      navigate("/cashier", { replace: true })
      return
    }
    invoke<ShiftSummary>("get_shift_summary", { shiftId: activeShift.id })
      .then((s) => {
        setSummary(s)
        setIsLoading(false)
        setTimeout(() => inputRef.current?.focus(), 100)
      })
      .catch(() => {
        setIsLoading(false)
        toast.error("Gagal memuat ringkasan shift")
      })
  }, [activeShift, navigate])

  const formatNumber = (num: number): string =>
    new Intl.NumberFormat("id-ID").format(num)

  const handleCashChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "")
    if (raw === "") {
      setClosingCash("")
      setDisplayCash("")
      return
    }
    const num = Number(raw)
    setClosingCash(String(num))
    setDisplayCash(formatNumber(num))
  }

  const handleClose = async () => {
    if (!activeShift) return
    setIsSubmitting(true)
    try {
      await invoke<ShiftSummary>("close_shift", {
        input: {
          shiftId: activeShift.id,
          closingCash: closingCash ? Number(closingCash) : undefined,
          notes: notes.trim() || undefined,
        },
      })
      clearShift()
      toast.success("Shift ditutup")
      navigate("/dashboard", { replace: true })
    } catch (err) {
      toast.error(`Gagal menutup shift: ${err}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const numericClosing = Number(closingCash) || 0
  const cashDifference =
    summary && closingCash ? numericClosing - summary.expectedCash : null

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Gagal memuat ringkasan shift.</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Kembali
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      {/* Page header */}
      <div className="flex items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Tutup Kasir</h1>
        </div>
      </div>

      {/* Detail Kasir card */}
      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" />
              Detail Kasir
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Kasir</p>
                <p className="text-sm font-medium">{summary.shift.userName}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Tanggal Buka</p>
                <p className="text-sm font-medium">{formatTime(summary.shift.openedAt)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Modal Awal</p>
                <p className="text-sm font-medium tabular-nums">{formatRp(summary.shift.openingCash)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-3 lg:px-6">
        <Card className="bg-gradient-to-t from-primary/5 to-card shadow-xs">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Receipt className="h-3.5 w-3.5" />
              Transaksi
            </CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {summary.totalTransactions}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-gradient-to-t from-primary/5 to-card shadow-xs">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <ShoppingBag className="h-3.5 w-3.5" />
              Total Penjualan
            </CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {formatRp(summary.totalSales)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-gradient-to-t from-primary/5 to-card shadow-xs border-primary/20">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" />
              Saldo Tutup Kasir
            </CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {formatRp(summary.expectedCash)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Detail cards */}
      <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-2 lg:px-6">
        {/* Payment breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4" />
              Pembayaran
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {summary.paymentBreakdown.length > 0 ? (
              <div className="space-y-3">
                {summary.paymentBreakdown.map((pb) => (
                  <div key={pb.method} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{paymentLabel(pb.method)}</span>
                    <span className="text-sm font-medium tabular-nums">{formatRp(pb.total)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Belum ada transaksi</p>
            )}
          </CardContent>
        </Card>

        {/* Cash flows */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Banknote className="h-4 w-4" />
              Uang Masuk / Keluar
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {summary.cashFlows.length > 0 ? (
              <div className="space-y-3">
                {summary.cashFlows.map((cf) => (
                  <Tooltip key={cf.id}>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 cursor-default">
                        {cf.flowType === "in" ? (
                          <ArrowDownCircle className="h-4 w-4 shrink-0 text-green-600" />
                        ) : (
                          <ArrowUpCircle className="h-4 w-4 shrink-0 text-red-500" />
                        )}
                        <span className="min-w-0 truncate text-sm text-muted-foreground">{cf.description}</span>
                        <span className={`ml-auto shrink-0 text-sm font-medium tabular-nums ${cf.flowType === "in" ? "text-green-600" : "text-red-500"}`}>
                          {cf.flowType === "in" ? "+" : "-"}{formatRp(cf.amount)}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="max-w-xs">{cf.description}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
                <div className="flex items-center justify-between border-t pt-3">
                  <span className="text-sm font-medium">Total</span>
                  <span className={`text-sm font-semibold tabular-nums ${(summary.cashIn - summary.cashOut) >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {(summary.cashIn - summary.cashOut) >= 0 ? "+" : ""}{formatRp(summary.cashIn - summary.cashOut)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Tidak ada arus kas</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Close shift action */}
      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tutup Shift</CardTitle>
            <CardDescription>Masukkan saldo aktual di laci kasir lalu tutup shift</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="closing-cash">Saldo Aktual</Label>
                <Input
                  ref={inputRef}
                  id="closing-cash"
                  type="text"
                  inputMode="numeric"
                  className="h-12 text-lg font-bold text-right tabular-nums"
                  placeholder="Opsional"
                  value={displayCash}
                  onChange={handleCashChange}
                />
                {cashDifference !== null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted-foreground">Selisih:</span>
                    <Badge
                      variant={
                        Math.abs(cashDifference) < 1
                          ? "secondary"
                          : cashDifference < 0
                            ? "destructive"
                            : "default"
                      }
                    >
                      {cashDifference >= 0 ? "+" : ""}{formatRp(cashDifference)}
                    </Badge>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="close-notes">Catatan</Label>
                <Input
                  id="close-notes"
                  className="h-12"
                  placeholder="Opsional"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              variant="destructive"
              className="h-12 w-full text-base font-semibold"
              disabled={isSubmitting}
              onClick={handleClose}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Menutup...
                </>
              ) : (
                "Tutup Kasir"
              )}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
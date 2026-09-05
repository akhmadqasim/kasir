import { useCallback, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import {
  AlertDialog,
  Button,
  Card,
  Input,
  Label,
  Spinner,
  TextField,
  Tooltip,
} from "@heroui/react"
import {
  ArrowDownCircle,
  ArrowLeft,
  ArrowUpCircle,
  Banknote,
  CreditCard,
  Receipt,
  ShoppingBag,
  Trash2,
  User,
  Wallet,
} from "lucide-react"

import { StatusBadge } from "@/components/status-badge"
import { getDefaultRouteForRole } from "@/app/resume-route"
import { useAuthStore } from "@/features/auth"
import { formatDateTime, formatRupiah } from "@/lib/format"
import { paymentMethodLabel } from "@/lib/labels"
import { toast } from "@/lib/toast"
import { ShiftCloseReport } from "./shift-close-report"
import { useShiftStore } from "../hooks/use-shift-store"
import { cashDifferenceStatus, groupDigits, signedRupiah, toDigits } from "../utils"
import type { CashFlow, ShiftSummary } from "../types"

/**
 * Closing a shift is irreversible, so it takes two confirmations: a summary to
 * read, then a plain "are you sure". `"idle"` means neither dialog is up.
 */
type CloseStep = "idle" | "review" | "final"

export function CloseShiftPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [closingCash, setClosingCash] = useState("")
  const [notes, setNotes] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeletingCashFlow, setIsDeletingCashFlow] = useState(false)
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [closedSummary, setClosedSummary] = useState<ShiftSummary | null>(null)
  const [cashFlowToDelete, setCashFlowToDelete] = useState<CashFlow | null>(null)
  const [closeStep, setCloseStep] = useState<CloseStep>("idle")
  const [storeName, setStoreName] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const activeShift = useShiftStore((s) => s.activeShift)
  const clearShift = useShiftStore((s) => s.clearShift)

  useEffect(() => {
    invoke<{ name: string } | null>("get_store_info")
      .then((info) => { if (info) setStoreName(info.name) })
      .catch(() => {})
  }, [])

  const loadSummary = useCallback(async () => {
    if (!activeShift) return
    const s = await invoke<ShiftSummary>("get_shift_summary", { shiftId: activeShift.id })
    setSummary(s)
  }, [activeShift])

  useEffect(() => {
    if (!activeShift) {
      if (!closedSummary) {
        // An admin has no business being dropped on the cashier screen; send
        // everyone to the same landing route the router picks after login.
        navigate(getDefaultRouteForRole(user?.role ?? "kasir"), { replace: true })
      }
      return
    }
    loadSummary()
      .then(() => setIsLoading(false))
      .catch(() => {
        setIsLoading(false)
        toast.error("Gagal memuat ringkasan shift")
      })
  }, [activeShift, closedSummary, navigate, loadSummary, user?.role])

  const handleDeleteCashFlow = async () => {
    if (!cashFlowToDelete || !user) return

    setIsDeletingCashFlow(true)
    try {
      await invoke("delete_cash_flow", {
        cashFlowId: cashFlowToDelete.id,
        callerId: user.id,
      })
      await loadSummary()
      toast.success("Arus kas berhasil dihapus")
      setCashFlowToDelete(null)
    } catch (err) {
      toast.error(`Gagal menghapus arus kas: ${err}`)
    } finally {
      setIsDeletingCashFlow(false)
    }
  }

  const handleClose = async () => {
    if (!activeShift) return
    setIsSubmitting(true)
    try {
      const result = await invoke<ShiftSummary>("close_shift", {
        input: {
          shiftId: activeShift.id,
          closingCash: closingCash ? Number(closingCash) : undefined,
          notes: notes.trim() || undefined,
        },
      })
      clearShift()
      toast.success("Shift ditutup")
      setCloseStep("idle")
      setClosedSummary(result)
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
        <Spinner aria-label="Memuat ringkasan shift" color="current" size="lg" className="text-muted" />
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-muted">Gagal memuat ringkasan shift.</p>
        <Button variant="outline" onPress={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Kembali
        </Button>
      </div>
    )
  }

  if (closedSummary) {
    return (
      <ShiftCloseReport
        summary={closedSummary}
        storeName={storeName}
        onBack={() =>
          navigate(getDefaultRouteForRole(user?.role ?? "kasir"), { replace: true })
        }
        onLogout={() => {
          useAuthStore.getState().logout()
          navigate("/login", { replace: true })
        }}
      />
    )
  }

  const canDeleteCashFlow = (cf: CashFlow) =>
    user?.role === "admin" || user?.id === cf.userId

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      {/* Page header */}
      <div className="flex items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <Button
            aria-label="Kembali"
            isIconOnly
            variant="ghost"
            onPress={() => navigate(-1)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Tutup Kasir</h1>
        </div>
      </div>

      {/* Detail Kasir card */}
      <div className="px-4 lg:px-6">
        <Card>
          <Card.Header>
            <Card.Title className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" />
              Detail Kasir
            </Card.Title>
          </Card.Header>
          <Card.Content>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted">Kasir</p>
                <p className="text-sm font-medium">{summary.shift.userName}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted">Tanggal Buka</p>
                <p className="text-sm font-medium">{formatDateTime(summary.shift.openedAt)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted">Modal Awal</p>
                <p className="text-sm font-medium tabular-nums">
                  {formatRupiah(summary.shift.openingCash)}
                </p>
              </div>
            </div>
          </Card.Content>
        </Card>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-3 lg:px-6">
        <StatCard
          icon={<Receipt className="h-3.5 w-3.5" />}
          label="Transaksi"
          value={String(summary.totalTransactions)}
        />
        <StatCard
          icon={<ShoppingBag className="h-3.5 w-3.5" />}
          label="Total Penjualan"
          value={formatRupiah(summary.totalSales)}
        />
        <StatCard
          className="border border-accent/20"
          icon={<Wallet className="h-3.5 w-3.5" />}
          label="Saldo Tutup Kasir"
          value={formatRupiah(summary.expectedCash)}
        />
      </div>

      {/* Detail cards */}
      <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-2 lg:px-6">
        {/* Payment breakdown */}
        <Card>
          <Card.Header>
            <Card.Title className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4" />
              Pembayaran
            </Card.Title>
          </Card.Header>
          <Card.Content>
            {summary.paymentBreakdown.length > 0 ? (
              <div className="space-y-3">
                {summary.paymentBreakdown.map((pb) => (
                  <div key={pb.method} className="flex items-center justify-between">
                    <span className="text-sm text-muted">{paymentMethodLabel(pb.method)}</span>
                    <span className="text-sm font-medium tabular-nums">
                      {formatRupiah(pb.total)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">Belum ada transaksi</p>
            )}
          </Card.Content>
        </Card>

        {/* Cash flows */}
        <Card>
          <Card.Header>
            <Card.Title className="flex items-center gap-2 text-base">
              <Banknote className="h-4 w-4" />
              Uang Masuk / Keluar
            </Card.Title>
          </Card.Header>
          <Card.Content>
            {summary.cashFlows.length > 0 ? (
              <div className="space-y-3">
                {summary.cashFlows.map((cf) => (
                  <div key={cf.id} className="flex items-center gap-2">
                    {cf.flowType === "in" ? (
                      <ArrowDownCircle className="h-4 w-4 shrink-0 text-success" />
                    ) : (
                      <ArrowUpCircle className="h-4 w-4 shrink-0 text-danger" />
                    )}
                    <CashFlowDescription description={cf.description} />
                    <span
                      className={`ml-auto shrink-0 text-sm font-medium tabular-nums ${cf.flowType === "in" ? "text-success" : "text-danger"}`}
                    >
                      {cf.flowType === "in" ? "+" : "-"}
                      {formatRupiah(cf.amount)}
                    </span>
                    {canDeleteCashFlow(cf) && (
                      <Button
                        aria-label={`Hapus arus kas ${cf.description}`}
                        className="shrink-0 text-muted hover:text-danger"
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        onPress={() => setCashFlowToDelete(cf)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between border-t pt-3">
                  <span className="text-sm font-medium">Total</span>
                  <span
                    className={`text-sm font-semibold tabular-nums ${summary.cashIn - summary.cashOut >= 0 ? "text-success" : "text-danger"}`}
                  >
                    {signedRupiah(summary.cashIn - summary.cashOut)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">Tidak ada arus kas</p>
            )}
          </Card.Content>
        </Card>
      </div>

      {/* Close shift action */}
      <div className="px-4 lg:px-6">
        <Card>
          <Card.Header>
            <Card.Title className="text-base">Tutup Shift</Card.Title>
            <Card.Description>
              Masukkan saldo aktual di laci kasir lalu tutup shift
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <TextField
                  autoFocus
                  fullWidth
                  value={groupDigits(closingCash)}
                  onChange={(value) => setClosingCash(toDigits(value))}
                >
                  <Label>Saldo Aktual</Label>
                  <Input
                    className="h-12 text-right text-lg font-bold tabular-nums"
                    inputMode="numeric"
                    placeholder="Opsional"
                  />
                </TextField>
                {cashDifference !== null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted">Selisih:</span>
                    <StatusBadge status={cashDifferenceStatus(cashDifference)}>
                      {signedRupiah(cashDifference)}
                    </StatusBadge>
                  </div>
                )}
              </div>
              <TextField fullWidth value={notes} onChange={setNotes}>
                <Label>Catatan</Label>
                <Input className="h-12" placeholder="Opsional" />
              </TextField>
            </div>
          </Card.Content>
          <Card.Footer>
            <Button
              className="h-12 w-full text-base font-semibold"
              isDisabled={isSubmitting}
              variant="danger"
              onPress={() => setCloseStep("review")}
            >
              {isSubmitting ? "Menutup..." : "Tutup Kasir"}
            </Button>
          </Card.Footer>
        </Card>
      </div>

      {/* Step 1 of the close chain: read the numbers back.
          `isKeyboardDismissDisabled={false}` restores Escape-to-cancel, which the
          Radix alert dialog gave for free and HeroUI turns off by default. */}
      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={false}
        isOpen={closeStep === "review"}
        onOpenChange={(open) => !open && setCloseStep("idle")}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog aria-label="Konfirmasi Tutup Kasir">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Konfirmasi Tutup Kasir</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="space-y-3">
              <p className="text-sm text-muted">
                Pastikan semua transaksi hari ini sudah selesai sebelum shift ditutup.
              </p>
              <div className="space-y-2 rounded-md border bg-default/50 px-3 py-2 text-sm">
                <SummaryRow label="Kasir" value={summary.shift.userName} />
                <SummaryRow
                  label="Total transaksi"
                  value={String(summary.totalTransactions)}
                />
                <SummaryRow
                  label="Saldo aplikasi"
                  value={formatRupiah(summary.expectedCash)}
                />
                {closingCash ? (
                  <SummaryRow label="Saldo aktual" value={formatRupiah(numericClosing)} />
                ) : null}
                {cashDifference !== null ? (
                  <SummaryRow label="Selisih" value={signedRupiah(cashDifference)} />
                ) : null}
              </div>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                isDisabled={isSubmitting}
                variant="outline"
                onPress={() => setCloseStep("idle")}
              >
                Batal
              </Button>
              <Button
                isDisabled={isSubmitting}
                variant="danger"
                onPress={() => setCloseStep("final")}
              >
                Lanjutkan
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      {/* Step 2: the last stop before the shift is actually closed. */}
      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={false}
        isOpen={closeStep === "final"}
        onOpenChange={(open) => !open && setCloseStep("idle")}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog aria-label="Verifikasi Terakhir">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Verifikasi Terakhir</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="space-y-3">
              <p className="text-sm text-muted">
                Shift akan ditutup sekarang dan laporan tutup kasir akan dibuat. Lanjutkan
                hanya jika Anda benar-benar yakin.
              </p>
              <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">
                Tindakan ini tidak untuk transaksi aktif. Pastikan tidak ada pelanggan yang
                masih dalam proses pembayaran.
              </div>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                isDisabled={isSubmitting}
                variant="outline"
                onPress={() => setCloseStep("idle")}
              >
                Kembali
              </Button>
              <Button isDisabled={isSubmitting} variant="danger" onPress={handleClose}>
                {isSubmitting ? "Menutup..." : "Ya, Tutup Kasir"}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={false}
        isOpen={!!cashFlowToDelete}
        onOpenChange={(open) => !open && setCashFlowToDelete(null)}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog aria-label="Hapus Arus Kas">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Hapus Arus Kas</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="space-y-3">
              <p className="text-sm text-muted">
                Entri uang masuk/keluar ini akan dihapus dari shift yang sedang berjalan.
              </p>
              {cashFlowToDelete && (
                <div className="rounded-md border bg-default/50 px-3 py-2 text-sm">
                  <div>
                    <span className="text-muted">Jenis:</span>{" "}
                    {cashFlowToDelete.flowType === "in" ? "Uang Masuk" : "Uang Keluar"}
                  </div>
                  <div>
                    <span className="text-muted">Nominal:</span>{" "}
                    {formatRupiah(cashFlowToDelete.amount)}
                  </div>
                  <div>
                    <span className="text-muted">Keterangan:</span>{" "}
                    {cashFlowToDelete.description}
                  </div>
                </div>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                isDisabled={isDeletingCashFlow}
                variant="outline"
                onPress={() => setCashFlowToDelete(null)}
              >
                Batal
              </Button>
              <Button
                isDisabled={isDeletingCashFlow}
                variant="danger"
                onPress={handleDeleteCashFlow}
              >
                {isDeletingCashFlow ? "Menghapus..." : "Hapus"}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

function StatCard({
  className,
  icon,
  label,
  value,
}: {
  className?: string
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <Card className={`bg-gradient-to-t from-accent/5 to-surface shadow-xs ${className ?? ""}`}>
      <Card.Header>
        <Card.Description className="flex items-center gap-1.5">
          {icon}
          {label}
        </Card.Description>
        <Card.Title className="text-2xl font-semibold tabular-nums">{value}</Card.Title>
      </Card.Header>
    </Card>
  )
}

/**
 * The description is truncated, so the tooltip is the only way to read a long
 * one — but it explains *text*, not a control. `Tooltip.Trigger` would otherwise
 * wrap it in `div[role=button][tabindex=0]` and put a tab stop on every row,
 * between the row above and the delete button beside it. The render function
 * drops both attributes and keeps the hover handlers, which is what the Radix
 * `asChild` trigger did.
 */
function CashFlowDescription({ description }: { description: string }) {
  return (
    <Tooltip>
      <Tooltip.Trigger<"span">
        render={({ role: _role, tabIndex: _tabIndex, className, ...domProps }) => (
          <span {...domProps} className={`min-w-0 truncate text-sm text-muted ${className ?? ""}`}>
            {description}
          </span>
        )}
      />
      <Tooltip.Content placement="top">
        <p className="max-w-xs">{description}</p>
      </Tooltip.Content>
    </Tooltip>
  )
}

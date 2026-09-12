import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Alert,
  AlertDialog,
  Button,
  Card,
  Input,
  Label,
  Separator,
  Spinner,
  TextField,
  Tooltip,
} from "@heroui/react"
import { ArrowDownCircle, ArrowLeft, ArrowUpCircle, Trash2 } from "lucide-react"

import { InfoPanel } from "@/components/info-panel"
import { SubpageHeader } from "@/components/layout/subpage-header"
import { NoData } from "@/components/no-data"
import { PendingButton } from "@/components/pending-button"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { SummaryList } from "@/components/summary-list"
import { getDefaultRouteForRole } from "@/app/resume-route"
import { useAuthStore } from "@/features/auth"
import { useLogout } from "@/features/auth/hooks/use-auth"
import * as shiftsApi from "@/lib/api/shifts"
import { getStoreInfo } from "@/lib/api/settings"
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
  const logout = useLogout()
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
    getStoreInfo()
      .then((info) => {
        if (info) setStoreName(info.name)
      })
      .catch(() => {})
  }, [])

  const loadSummary = useCallback(async () => {
    if (!activeShift) return
    setSummary(await shiftsApi.getShiftSummary(activeShift.id))
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
      await shiftsApi.deleteCashFlow(cashFlowToDelete.id)
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
      const result = await shiftsApi.closeShift(activeShift.id, {
        closingCash: closingCash ? Number(closingCash) : undefined,
        notes: notes.trim() || undefined,
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
  const cashDifference = summary && closingCash ? numericClosing - summary.expectedCash : null

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner
          aria-label="Memuat ringkasan shift"
          color="current"
          size="lg"
          className="text-muted"
        />
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <NoData title="Gagal memuat ringkasan shift." tone="danger" />
        <Button variant="tertiary" onPress={() => navigate(-1)}>
          <ArrowLeft />
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
        onBack={() => navigate(getDefaultRouteForRole(user?.role ?? "kasir"), { replace: true })}
        onLogout={() => {
          logout.mutate(undefined, {
            onSettled: () => navigate("/login", { replace: true }),
          })
        }}
      />
    )
  }

  const canDeleteCashFlow = (cf: CashFlow) => user?.role === "admin" || user?.id === cf.userId

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <SubpageHeader title="Tutup Kasir" onBack={() => navigate(-1)} />

      {/* Detail Kasir card */}
      <Card>
        <Card.Header>
          <Card.Title>Detail Kasir</Card.Title>
        </Card.Header>
        <Card.Content>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted">Kasir</p>
              <p className="font-medium">{summary.shift.userName}</p>
            </div>
            <div>
              <p className="text-muted">Tanggal Buka</p>
              <p className="font-medium">{formatDateTime(summary.shift.openedAt)}</p>
            </div>
            <div>
              <p className="text-muted">Modal Awal</p>
              <p className="font-medium tabular-nums">{formatRupiah(summary.shift.openingCash)}</p>
            </div>
          </div>
        </Card.Content>
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Transaksi" value={String(summary.totalTransactions)} />
        <StatCard label="Total Penjualan" value={formatRupiah(summary.totalSales)} />
        <StatCard label="Saldo Tutup Kasir" value={formatRupiah(summary.expectedCash)} />
      </div>

      {/* Detail cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Payment breakdown */}
        <Card>
          <Card.Header>
            <Card.Title>Pembayaran</Card.Title>
          </Card.Header>
          <Card.Content>
            {summary.paymentBreakdown.length > 0 ? (
              <SummaryList
                items={summary.paymentBreakdown.map((pb) => ({
                  label: paymentMethodLabel(pb.method),
                  value: formatRupiah(pb.total),
                }))}
              />
            ) : (
              <NoData title="Belum ada transaksi" />
            )}
          </Card.Content>
        </Card>

        {/* Cash flows */}
        <Card>
          <Card.Header>
            <Card.Title>Uang Masuk / Keluar</Card.Title>
          </Card.Header>
          <Card.Content>
            {summary.cashFlows.length > 0 ? (
              <div className="flex flex-col gap-3">
                {summary.cashFlows.map((cf) => (
                  <div key={cf.id} className="flex items-center gap-2">
                    {cf.flowType === "in" ? (
                      <ArrowDownCircle className="size-4 shrink-0 text-success" />
                    ) : (
                      <ArrowUpCircle className="size-4 shrink-0 text-danger" />
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
                        className="shrink-0"
                        isIconOnly
                        size="sm"
                        variant="danger"
                        onPress={() => setCashFlowToDelete(cf)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                ))}
                <Separator />
                <SummaryList
                  items={[
                    {
                      label: "Total",
                      value: signedRupiah(summary.cashIn - summary.cashOut),
                      tone: summary.cashIn - summary.cashOut >= 0 ? "success" : "danger",
                    },
                    // Retur tunai bukan arus kas manual, tapi sudah dipotong dari
                    // saldo tutup kasir. Tanpa barisnya, laci kurang dan tidak ada
                    // yang menjelaskan kenapa.
                    ...(summary.cashRefunds > 0
                      ? [
                          {
                            label: "Retur tunai",
                            value: signedRupiah(-summary.cashRefunds),
                            tone: "danger" as const,
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            ) : (
              <NoData title="Tidak ada arus kas" />
            )}
          </Card.Content>
        </Card>
      </div>

      {/* Close shift action */}
      <Card>
        <Card.Header>
          <Card.Title>Tutup Shift</Card.Title>
          <Card.Description>Masukkan saldo aktual di laci kasir lalu tutup shift</Card.Description>
        </Card.Header>
        <Card.Content>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <TextField
                autoFocus
                fullWidth
                value={groupDigits(closingCash)}
                variant="secondary"
                onChange={(value) => setClosingCash(toDigits(value))}
              >
                <Label>Saldo Aktual</Label>
                <Input
                  className="text-right tabular-nums"
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
            <TextField fullWidth value={notes} variant="secondary" onChange={setNotes}>
              <Label>Catatan</Label>
              <Input placeholder="Opsional" />
            </TextField>
          </div>
        </Card.Content>
        <Card.Footer>
          {/* Hanya membuka langkah review — belum ada mutasi, jadi bukan `isPending`. */}
          <Button
            fullWidth
            isDisabled={isSubmitting}
            variant="danger"
            onPress={() => setCloseStep("review")}
          >
            Tutup Kasir
          </Button>
        </Card.Footer>
      </Card>

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
            <AlertDialog.Body>
              <p>Pastikan semua transaksi hari ini sudah selesai sebelum shift ditutup.</p>
              <InfoPanel>
                <SummaryList
                  items={[
                    { label: "Kasir", value: summary.shift.userName },
                    { label: "Total transaksi", value: String(summary.totalTransactions) },
                    { label: "Saldo aplikasi", value: formatRupiah(summary.expectedCash) },
                    ...(closingCash
                      ? [{ label: "Saldo aktual", value: formatRupiah(numericClosing) }]
                      : []),
                    ...(cashDifference !== null
                      ? [{ label: "Selisih", value: signedRupiah(cashDifference) }]
                      : []),
                  ]}
                />
              </InfoPanel>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button isDisabled={isSubmitting} slot="close" variant="tertiary">
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
            <AlertDialog.Body>
              <p>
                Shift akan ditutup sekarang dan laporan tutup kasir akan dibuat. Lanjutkan hanya
                jika Anda benar-benar yakin.
              </p>
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>
                    Tindakan ini tidak untuk transaksi aktif. Pastikan tidak ada pelanggan yang
                    masih dalam proses pembayaran.
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button isDisabled={isSubmitting} slot="close" variant="tertiary">
                Kembali
              </Button>
              <PendingButton isPending={isSubmitting} variant="danger" onPress={handleClose}>
                Ya, Tutup Kasir
              </PendingButton>
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
            <AlertDialog.Body>
              <p>Entri uang masuk/keluar ini akan dihapus dari shift yang sedang berjalan.</p>
              {cashFlowToDelete && (
                <InfoPanel>
                  <SummaryList
                    layout="grid"
                    items={[
                      {
                        label: "Jenis",
                        value: cashFlowToDelete.flowType === "in" ? "Uang Masuk" : "Uang Keluar",
                      },
                      { label: "Nominal", value: formatRupiah(cashFlowToDelete.amount) },
                      { label: "Keterangan", value: cashFlowToDelete.description },
                    ]}
                  />
                </InfoPanel>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button isDisabled={isDeletingCashFlow} slot="close" variant="tertiary">
                Batal
              </Button>
              <PendingButton
                isPending={isDeletingCashFlow}
                variant="danger"
                onPress={handleDeleteCashFlow}
              >
                Hapus
              </PendingButton>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
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

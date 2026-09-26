import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button, Card } from "@heroui/react"
import { ArrowLeft, ReceiptText } from "lucide-react"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { StatCard } from "@/components/stat-card"
import { SummaryList } from "@/components/summary-list"
import { getDefaultRouteForRole } from "@/app/resume-route"
import { useGoBack } from "@/hooks/use-go-back"
import { useAuthStore, useLogout } from "@/features/auth"
import { useStoreInfo } from "@/features/settings"
import { errorMessage } from "@/lib/api/client"
import * as shiftsApi from "@/lib/api/shifts"
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { CashFlowsCard } from "./close-shift/cash-flows-card"
import { CloseShiftConfirmDialogs, type CloseStep } from "./close-shift/close-shift-confirm-dialogs"
import { CloseShiftSkeleton } from "./close-shift/close-shift-skeleton"
import { ClosingCashCard } from "./close-shift/closing-cash-card"
import { DeleteCashFlowDialog } from "./close-shift/delete-cash-flow-dialog"
import { CardHeading } from "./card-heading"
import { ShiftCloseReport } from "./shift-close-report"
import { useShiftStore } from "../hooks/use-shift-store"
import { useShiftSummary } from "../hooks/use-shift-summary"
import { paymentBreakdownItems } from "../utils"
import type { CashFlow, ShiftSummary } from "../types"

const PAGE_TITLE = "Tutup Kasir"

export function CloseShiftPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const logout = useLogout()
  const [closingCash, setClosingCash] = useState("")
  const [notes, setNotes] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [closedSummary, setClosedSummary] = useState<ShiftSummary | null>(null)
  const [cashFlowToDelete, setCashFlowToDelete] = useState<CashFlow | null>(null)
  const [closeStep, setCloseStep] = useState<CloseStep>("idle")
  const activeShift = useShiftStore((s) => s.activeShift)
  const fetchActiveShift = useShiftStore((s) => s.fetchActiveShift)
  const clearShift = useShiftStore((s) => s.clearShift)
  // Only the cashier screen loads the shift into the store. Opened from its
  // address, reloaded, or resumed after a restart, this page comes up with an
  // empty store and used to bounce straight home; ask the server first, and
  // leave only when it answers that there is no open shift.
  const [shiftChecked, setShiftChecked] = useState(
    () => useShiftStore.getState().activeShift !== null,
  )
  const storeName = useStoreInfo().data?.name ?? ""
  const { summary, isLoading, loadError, retry, removeCashFlow } = useShiftSummary(activeShift)
  const homeRoute = getDefaultRouteForRole(user?.role ?? "kasir")

  useEffect(() => {
    if (shiftChecked) return
    let isCurrent = true
    void fetchActiveShift().finally(() => {
      if (isCurrent) setShiftChecked(true)
    })
    return () => {
      isCurrent = false
    }
  }, [shiftChecked, fetchActiveShift])

  useEffect(() => {
    // An admin has no business being dropped on the cashier screen; send
    // everyone to the same landing route the router picks after login. A shift
    // that was closed here stays put: its report is on screen.
    if (shiftChecked && !activeShift && !closedSummary) navigate(homeRoute, { replace: true })
  }, [shiftChecked, activeShift, closedSummary, navigate, homeRoute])

  const handleClose = async () => {
    if (!activeShift || isSubmitting) return
    setIsSubmitting(true)
    try {
      const result = await shiftsApi.closeShift(activeShift.id, {
        closingCash: closingCash ? Number(closingCash) : undefined,
        notes: notes.trim() || undefined,
      })
      clearShift()
      toast.success(id.shift.closed)
      setCloseStep("idle")
      setClosedSummary(result)
    } catch (err) {
      toast.error(id.shift.closeFailed(errorMessage(err)))
    } finally {
      setIsSubmitting(false)
    }
  }

  // Opened straight from its address there is nothing of ours to step back
  // to; the cashier lands on their own start screen instead of being stuck.
  const goBack = useGoBack(homeRoute)

  if (isLoading) {
    return <CloseShiftSkeleton title={PAGE_TITLE} onBack={goBack} />
  }

  if (!summary) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <SubpageHeader title={PAGE_TITLE} onBack={goBack} />
        <LoadError
          secondaryAction={
            <Button size="sm" variant="tertiary" onPress={goBack}>
              <ArrowLeft />
              {id.common.back}
            </Button>
          }
          isRetrying={isLoading}
          title={id.loadFailed.shiftSummary}
          onRetry={retry}
        >
          {loadError}
        </LoadError>
      </div>
    )
  }

  if (closedSummary) {
    return (
      <ShiftCloseReport
        summary={closedSummary}
        storeName={storeName}
        isLoggingOut={logout.isPending}
        onBack={() => navigate(homeRoute, { replace: true })}
        onLogout={() => {
          if (logout.isPending) return
          logout.mutate(undefined, {
            onSettled: () => navigate("/login", { replace: true }),
          })
        }}
      />
    )
  }

  const countedCash = closingCash ? Number(closingCash) : null
  const cashDifference = countedCash !== null ? countedCash - summary.expectedCash : null
  const canDeleteCashFlow = (cf: CashFlow) => user?.role === "admin" || user?.id === cf.userId

  return (
    // Padding luar milik `app-layout`; halaman hanya mengatur jarak antar kartu — DESIGN.md §3.5.
    <div className="flex flex-col gap-4">
      <SubpageHeader title={PAGE_TITLE} onBack={goBack} />

      {/* Detail Kasir card */}
      <Card>
        <Card.Header>
          <CardHeading>Detail Kasir</CardHeading>
        </Card.Header>
        <Card.Content>
          <SummaryList
            layout="grid"
            items={[
              { label: "Kasir", value: summary.shift.userName },
              { label: "Tanggal Buka", value: formatDateTime(summary.shift.openedAt) },
              { label: "Modal Awal", value: formatRupiah(summary.shift.openingCash) },
            ]}
          />
        </Card.Content>
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Transaksi" value={formatNumber(summary.totalTransactions)} />
        <StatCard label="Total Penjualan" value={formatRupiah(summary.totalSales)} />
        {/* Nama yang sama dengan "Saldo aplikasi" di dialog konfirmasi dan di
            laporan: satu nama untuk uang tunai yang seharusnya ada di laci. */}
        <StatCard label="Saldo Aplikasi" value={formatRupiah(summary.expectedCash)} />
      </div>

      {/* Detail cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Payment breakdown — jumlah transaksi ikut di label sebagai teks,
            sama dengan laporan cetaknya. */}
        <Card>
          <Card.Header>
            <CardHeading>Pembayaran</CardHeading>
          </Card.Header>
          <Card.Content>
            {summary.paymentBreakdown.length > 0 ? (
              <SummaryList items={paymentBreakdownItems(summary.paymentBreakdown)} />
            ) : (
              <NoData icon={<ReceiptText />} title={id.transactions.noTransactions} />
            )}
          </Card.Content>
        </Card>

        <CashFlowsCard
          canDelete={canDeleteCashFlow}
          summary={summary}
          onDelete={setCashFlowToDelete}
        />
      </div>

      <ClosingCashCard
        cashDifference={cashDifference}
        closingCash={closingCash}
        isSubmitting={isSubmitting}
        notes={notes}
        onClosingCashChange={setClosingCash}
        onNotesChange={setNotes}
        onRequestClose={() => setCloseStep("review")}
      />

      <CloseShiftConfirmDialogs
        cashDifference={cashDifference}
        closingCash={countedCash}
        isSubmitting={isSubmitting}
        step={closeStep}
        summary={summary}
        onConfirm={handleClose}
        onStepChange={setCloseStep}
      />

      <DeleteCashFlowDialog
        cashFlow={cashFlowToDelete}
        onClose={() => setCashFlowToDelete(null)}
        onDeleted={(cashFlow) => void removeCashFlow(cashFlow)}
      />
    </div>
  )
}

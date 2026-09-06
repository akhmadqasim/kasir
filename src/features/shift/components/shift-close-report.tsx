import { Button, Card, ScrollShadow, Separator } from "@heroui/react"
import {
  ArrowDownCircle,
  ArrowLeft,
  ArrowUpCircle,
  Banknote,
  CreditCard,
  LogOut,
  Printer,
  ShoppingBag,
  Store,
  User,
  Wallet,
} from "lucide-react"

import { StatusBadge } from "@/components/status-badge"
import { formatDateTime, formatRupiah } from "@/lib/format"
import { paymentMethodLabel } from "@/lib/labels"
import { cashDifferenceStatus, signedRupiah } from "../utils"
import type { ShiftSummary } from "../types"

interface ShiftCloseReportProps {
  summary: ShiftSummary
  storeName: string
  onBack: () => void
  onLogout: () => void
}

/**
 * The printed shift report.
 *
 * `window.print()` prints this component in place, so every ancestor's overflow
 * and mask still applies. `ScrollShadow` sets `overflow-y: auto` on itself and,
 * once the content is taller than the box, a `mask-image` fade at both edges —
 * neither is scoped to screen media, so both would clip and fade the paper.
 * The `print:` classes on the root undo them for the duration of the print.
 */
export function ShiftCloseReport({ summary, storeName, onBack, onLogout }: ShiftCloseReportProps) {
  const {
    shift,
    totalSales,
    totalTransactions,
    paymentBreakdown,
    cashFlows,
    cashIn,
    cashOut,
    cashRefunds,
    expectedCash,
  } = summary
  const closingCash = shift.closingCash ?? 0
  const hasClosingCash = shift.closingCash !== null
  const cashDifference = hasClosingCash ? closingCash - expectedCash : null
  const netCashFlow = cashIn - cashOut

  const handlePrint = () => {
    window.print()
  }

  return (
    <ScrollShadow className="h-full print:h-auto print:overflow-visible print:[-webkit-mask-image:none] print:[mask-image:none]">
      <div className="mx-auto max-w-2xl space-y-6 py-6 print:max-w-none print:py-2">
        {/* Report Header */}
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft print:hidden">
            <Store className="h-6 w-6 text-accent-soft-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Laporan Tutup Kasir</h1>
          {storeName && <p className="mt-1 text-muted">{storeName}</p>}
        </div>

        {/* Shift Info */}
        <Card>
          <Card.Header>
            <Card.Title className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" />
              Ringkasan
            </Card.Title>
          </Card.Header>
          <Card.Content>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <p className="text-muted">Kasir</p>
                <p className="font-medium">{shift.userName}</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted">Modal Awal</p>
                <p className="font-medium tabular-nums">{formatRupiah(shift.openingCash)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted">Dibuka</p>
                <p className="font-medium">{formatDateTime(shift.openedAt)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted">Ditutup</p>
                <p className="font-medium">{formatDateTime(shift.closedAt, "-")}</p>
              </div>
            </div>
          </Card.Content>
        </Card>

        {/* Sales Summary */}
        <Card>
          <Card.Header>
            <Card.Title className="flex items-center gap-2 text-base">
              <ShoppingBag className="h-4 w-4" />
              Penjualan
            </Card.Title>
          </Card.Header>
          <Card.Content>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Jumlah Transaksi</span>
                <span className="font-medium tabular-nums">{totalTransactions}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Total Penjualan</span>
                <span className="font-medium tabular-nums">{formatRupiah(totalSales)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-base font-semibold">
                <span>TOTAL</span>
                <span className="tabular-nums">{formatRupiah(totalSales)}</span>
              </div>
            </div>
          </Card.Content>
        </Card>

        {/* Payment Breakdown */}
        <Card>
          <Card.Header>
            <Card.Title className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4" />
              Jenis Pembayaran
            </Card.Title>
          </Card.Header>
          <Card.Content>
            {paymentBreakdown.length > 0 ? (
              <div className="space-y-2 text-sm">
                {paymentBreakdown.map((pb) => (
                  <div key={pb.method} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-muted">{paymentMethodLabel(pb.method)}</span>
                      <StatusBadge size="sm" status="neutral">{`${pb.count}x`}</StatusBadge>
                    </div>
                    <span className="font-medium tabular-nums">{formatRupiah(pb.total)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">Tidak ada transaksi</p>
            )}
          </Card.Content>
        </Card>

        {/* Cash Flows */}
        {cashFlows.length > 0 && (
          <Card>
            <Card.Header>
              <Card.Title className="flex items-center gap-2 text-base">
                <Banknote className="h-4 w-4" />
                Uang Masuk / Keluar
              </Card.Title>
            </Card.Header>
            <Card.Content>
              <div className="space-y-2 text-sm">
                {cashFlows.map((cf) => (
                  <div key={cf.id} className="flex items-center gap-2">
                    {cf.flowType === "in" ? (
                      <ArrowDownCircle className="h-4 w-4 shrink-0 text-success" />
                    ) : (
                      <ArrowUpCircle className="h-4 w-4 shrink-0 text-danger" />
                    )}
                    <span className="min-w-0 truncate text-muted">{cf.description}</span>
                    <span
                      className={`ml-auto shrink-0 font-medium tabular-nums ${cf.flowType === "in" ? "text-success" : "text-danger"}`}
                    >
                      {cf.flowType === "in" ? "+" : "-"}
                      {formatRupiah(cf.amount)}
                    </span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between font-medium">
                  <span>Total</span>
                  <span
                    className={`tabular-nums ${netCashFlow >= 0 ? "text-success" : "text-danger"}`}
                  >
                    {signedRupiah(netCashFlow)}
                  </span>
                </div>
              </div>
            </Card.Content>
          </Card>
        )}

        {/* Cash Reconciliation */}
        <Card className="border border-accent/20">
          <Card.Header>
            <Card.Title className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4" />
              Setoran Uang Tunai
            </Card.Title>
          </Card.Header>
          <Card.Content>
            <div className="space-y-2 text-sm">
              {hasClosingCash && (
                <div className="flex justify-between">
                  <span className="text-muted">Inputan Kasir</span>
                  <span className="font-medium tabular-nums">{formatRupiah(closingCash)}</span>
                </div>
              )}
              {/* Retur tunai sudah dipotong dari `expectedCash`. Ditulis
                  sendiri supaya saldo aplikasi yang lebih kecil dari penjualan
                  punya penjelasan di halaman yang sama. */}
              {cashRefunds > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">Retur Tunai</span>
                  <span className="font-medium tabular-nums text-danger">
                    {signedRupiah(-cashRefunds)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted">Dari Aplikasi</span>
                <span className="font-medium tabular-nums">{formatRupiah(expectedCash)}</span>
              </div>
              {cashDifference !== null && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Selisih</span>
                    <StatusBadge
                      className="tabular-nums"
                      status={cashDifferenceStatus(cashDifference)}
                    >
                      {signedRupiah(cashDifference)}
                    </StatusBadge>
                  </div>
                </>
              )}
            </div>
            {!hasClosingCash && (
              <p className="mt-2 text-xs text-muted">* Saldo aktual tidak diisi saat tutup kasir</p>
            )}
          </Card.Content>
        </Card>

        {shift.notes && (
          <Card>
            <Card.Header>
              <Card.Title className="text-base">Catatan</Card.Title>
            </Card.Header>
            <Card.Content>
              <p className="text-sm text-muted">{shift.notes}</p>
            </Card.Content>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 print:hidden">
          <Button className="h-12 flex-1" variant="outline" onPress={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Kembali
          </Button>
          <Button className="h-12 flex-1" variant="outline" onPress={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Cetak Laporan
          </Button>
          <Button className="h-12 flex-1" variant="danger" onPress={onLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Keluar
          </Button>
        </div>
      </div>
    </ScrollShadow>
  )
}

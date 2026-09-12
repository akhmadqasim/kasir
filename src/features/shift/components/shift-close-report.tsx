import { Button, Card, ScrollShadow, Separator } from "@heroui/react"
import { ArrowLeft, LogOut, Printer } from "lucide-react"

import { StatusBadge } from "@/components/status-badge"
import { SummaryList } from "@/components/summary-list"
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
      <div className="mx-auto flex max-w-2xl flex-col gap-4 print:max-w-none">
        {/* Kepala laporan. `<h1>` boleh di sini karena ini dokumen cetak — DESIGN.md §5.1. */}
        <div className="text-center">
          <h1 className="text-xl font-semibold">Laporan Tutup Kasir</h1>
          {storeName && <p className="text-sm text-muted">{storeName}</p>}
        </div>

        {/* Shift Info */}
        <Card>
          <Card.Header>
            <Card.Title>Ringkasan</Card.Title>
          </Card.Header>
          <Card.Content>
            <SummaryList
              layout="grid"
              items={[
                { label: "Kasir", value: shift.userName },
                { label: "Modal Awal", value: formatRupiah(shift.openingCash) },
                { label: "Dibuka", value: formatDateTime(shift.openedAt) },
                { label: "Ditutup", value: formatDateTime(shift.closedAt, "-") },
              ]}
            />
          </Card.Content>
        </Card>

        {/* Sales Summary */}
        <Card>
          <Card.Header>
            <Card.Title>Penjualan</Card.Title>
          </Card.Header>
          <Card.Content>
            <SummaryList
              items={[
                { label: "Jumlah Transaksi", value: String(totalTransactions) },
                { label: "Total Penjualan", value: formatRupiah(totalSales), tone: "strong" },
              ]}
            />
          </Card.Content>
        </Card>

        {/* Payment Breakdown — jumlah transaksi ikut di label sebagai teks,
            bukan lencana: DESIGN.md §5.4. */}
        <Card>
          <Card.Header>
            <Card.Title>Jenis Pembayaran</Card.Title>
          </Card.Header>
          <Card.Content>
            {paymentBreakdown.length > 0 ? (
              <SummaryList
                items={paymentBreakdown.map((pb) => ({
                  label: `${paymentMethodLabel(pb.method)} (${pb.count}×)`,
                  value: formatRupiah(pb.total),
                }))}
              />
            ) : (
              <p className="text-sm text-muted">Tidak ada transaksi</p>
            )}
          </Card.Content>
        </Card>

        {/* Cash Flows */}
        {cashFlows.length > 0 && (
          <Card>
            <Card.Header>
              <Card.Title>Uang Masuk / Keluar</Card.Title>
            </Card.Header>
            <Card.Content>
              <SummaryList
                items={cashFlows.map((cf) => ({
                  label: cf.description,
                  value: signedRupiah(cf.flowType === "in" ? cf.amount : -cf.amount),
                  tone: cf.flowType === "in" ? "success" : "danger",
                }))}
              />
              <Separator />
              <SummaryList
                items={[
                  {
                    label: "Total",
                    value: signedRupiah(netCashFlow),
                    tone: netCashFlow >= 0 ? "success" : "danger",
                  },
                ]}
              />
            </Card.Content>
          </Card>
        )}

        {/* Cash Reconciliation */}
        <Card>
          <Card.Header>
            <Card.Title>Setoran Uang Tunai</Card.Title>
          </Card.Header>
          <Card.Content>
            <SummaryList
              items={[
                ...(hasClosingCash
                  ? [{ label: "Inputan Kasir", value: formatRupiah(closingCash) }]
                  : []),
                // Retur tunai sudah dipotong dari `expectedCash`. Ditulis sendiri
                // supaya saldo aplikasi yang lebih kecil dari penjualan punya
                // penjelasan di halaman yang sama.
                ...(cashRefunds > 0
                  ? [
                      {
                        label: "Retur Tunai",
                        value: signedRupiah(-cashRefunds),
                        tone: "danger" as const,
                      },
                    ]
                  : []),
                { label: "Dari Aplikasi", value: formatRupiah(expectedCash) },
              ]}
            />
            {cashDifference !== null && (
              <>
                <Separator />
                <div className="flex items-center justify-between text-sm">
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
          </Card.Content>
          {!hasClosingCash && (
            <Card.Footer>
              <p className="text-xs text-muted">Saldo aktual tidak diisi saat tutup kasir.</p>
            </Card.Footer>
          )}
        </Card>

        {shift.notes && (
          <Card>
            <Card.Header>
              <Card.Title>Catatan</Card.Title>
            </Card.Header>
            <Card.Content>
              <p className="text-sm text-muted">{shift.notes}</p>
            </Card.Content>
          </Card>
        )}

        {/* Satu aksi utama (cetak); keluar hanya mengakhiri sesi, bukan merusak. */}
        <div className="flex flex-wrap justify-end gap-2 print:hidden">
          <Button variant="tertiary" onPress={onBack}>
            <ArrowLeft />
            Kembali
          </Button>
          <Button variant="secondary" onPress={onLogout}>
            <LogOut />
            Keluar
          </Button>
          <Button onPress={handlePrint}>
            <Printer />
            Cetak Laporan
          </Button>
        </div>
      </div>
    </ScrollShadow>
  )
}

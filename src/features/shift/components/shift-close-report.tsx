import { Button, Card, ScrollShadow, Separator } from "@heroui/react"
import { ArrowLeft, LogOut, Printer } from "lucide-react"

import { id } from "@/i18n/id"
import { PendingButton } from "@/components/pending-button"
import { StatusBadge } from "@/components/status-badge"
import { SummaryList } from "@/components/summary-list"
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format"
import {
  cashDifferenceStatus,
  cashDifferenceText,
  netCashFlowItem,
  paymentBreakdownItems,
  signedCashFlowAmount,
  signedRupiah,
} from "../utils"
import type { ShiftSummary } from "../types"
import { CardHeading } from "./card-heading"

interface ShiftCloseReportProps {
  summary: ShiftSummary
  storeName: string
  onBack: () => void
  onLogout: () => void
  /** `true` selama permintaan keluar berjalan: tombolnya menunggu, tidak bisa ditekan dua kali. */
  isLoggingOut?: boolean
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
export function ShiftCloseReport({
  summary,
  storeName,
  onBack,
  onLogout,
  isLoggingOut = false,
}: ShiftCloseReportProps) {
  const {
    shift,
    totalSales,
    totalTransactions,
    paymentBreakdown,
    cashFlows,
    cashRefunds,
    expectedCash,
  } = summary
  const closingCash = shift.closingCash ?? 0
  const hasClosingCash = shift.closingCash !== null
  const cashDifference = hasClosingCash ? closingCash - expectedCash : null

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
            <CardHeading>Ringkasan</CardHeading>
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
            <CardHeading>Penjualan</CardHeading>
          </Card.Header>
          <Card.Content>
            <SummaryList
              items={[
                { label: "Jumlah Transaksi", value: formatNumber(totalTransactions) },
                { label: "Total Penjualan", value: formatRupiah(totalSales), tone: "strong" },
              ]}
            />
          </Card.Content>
        </Card>

        {/* Payment Breakdown — jumlah transaksi ikut di label sebagai teks,
            bukan lencana: DESIGN.md §5.4. */}
        <Card>
          <Card.Header>
            <CardHeading>Jenis Pembayaran</CardHeading>
          </Card.Header>
          <Card.Content>
            {paymentBreakdown.length > 0 ? (
              <SummaryList items={paymentBreakdownItems(paymentBreakdown)} />
            ) : (
              <p className="text-sm text-muted">{id.transactions.noTransactions}</p>
            )}
          </Card.Content>
        </Card>

        {/* Cash Flows */}
        {cashFlows.length > 0 && (
          <Card>
            <Card.Header>
              <CardHeading>Uang Masuk / Keluar</CardHeading>
            </Card.Header>
            <Card.Content>
              <SummaryList
                items={cashFlows.map((cf) => ({
                  label: cf.description,
                  value: signedRupiah(signedCashFlowAmount(cf)),
                  tone: cf.flowType === "in" ? "success" : "danger",
                }))}
              />
              <Separator />
              <SummaryList items={[netCashFlowItem(summary)]} />
            </Card.Content>
          </Card>
        )}

        {/* Cash Reconciliation */}
        <Card>
          <Card.Header>
            <CardHeading>Setoran Uang Tunai</CardHeading>
          </Card.Header>
          <Card.Content>
            <SummaryList
              items={[
                ...(hasClosingCash
                  ? [{ label: "Saldo Aktual", value: formatRupiah(closingCash) }]
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
                { label: "Saldo Aplikasi", value: formatRupiah(expectedCash) },
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
                    {cashDifferenceText(cashDifference)}
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
              <CardHeading>Catatan</CardHeading>
            </Card.Header>
            <Card.Content>
              <p className="text-sm text-muted">{shift.notes}</p>
            </Card.Content>
          </Card>
        )}

        {/* Satu aksi utama (cetak); keluar hanya mengakhiri sesi, bukan merusak. */}
        <div className="flex flex-wrap justify-end gap-2 print:hidden">
          {/* Nonaktif selagi keluar: begitu permintaannya selesai layar tetap
              pindah ke halaman masuk, jadi "Kembali" di tengahnya hanya
              memperlihatkan halaman kasir sekejap. */}
          <Button isDisabled={isLoggingOut} variant="tertiary" onPress={onBack}>
            <ArrowLeft />
            Kembali
          </Button>
          <PendingButton isPending={isLoggingOut} variant="secondary" onPress={onLogout}>
            {isLoggingOut ? null : <LogOut />}
            Keluar
          </PendingButton>
          <Button onPress={handlePrint}>
            <Printer />
            Cetak Laporan
          </Button>
        </div>
      </div>
    </ScrollShadow>
  )
}

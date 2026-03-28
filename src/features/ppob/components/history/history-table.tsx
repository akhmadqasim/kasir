import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import { useState } from "react"
import type { HistoryPaymentItem } from "../../types"
import {
  detectServiceType,
  normalizeStatus,
  formatRupiah,
  formatDateTime,
  buildDescription,
  getNominal,
} from "./history-utils"

function StatusBadge({ status }: { status: string | null }) {
  const normalized = normalizeStatus(status)
  switch (normalized) {
    case "sukses":
      return <Badge className="bg-green-600 hover:bg-green-700 text-white">Sukses</Badge>
    case "gagal":
      return <Badge variant="destructive">Gagal</Badge>
    case "proses":
      return <Badge variant="secondary">Proses</Badge>
    default:
      return <Badge variant="outline">{status ?? "-"}</Badge>
  }
}

function DetailRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value || value === "-") return null
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  )
}

function TransactionDetailDialog({
  item,
  onClose,
}: {
  item: HistoryPaymentItem | null
  onClose: () => void
}) {
  if (!item) return null

  const service = detectServiceType(item)
  const Icon = service.icon
  const nominal = getNominal(item)
  const profit = item.amount != null && item.basePrice != null ? item.amount - item.basePrice : null

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Detail Transaksi</DialogTitle>
        </DialogHeader>

        {/* Header: service info + status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${service.bg}`}>
              <Icon className={`h-5 w-5 ${service.text}`} />
            </div>
            <div>
              <p className="font-semibold">{service.label}</p>
              <p className="text-sm text-muted-foreground">{formatDateTime(item.createdAt)}</p>
            </div>
          </div>
          <StatusBadge status={item.status} />
        </div>

        <Separator />

        {/* Description */}
        <div className="text-sm">
          <p className="text-muted-foreground mb-1">Deskripsi</p>
          <p className="font-medium">{buildDescription(item)}</p>
        </div>

        <Separator />

        {/* Detail fields */}
        <div className="space-y-1.5">
          <DetailRow label="No. Transaksi" value={item.trxId} mono />
          <DetailRow label="No. Pelanggan" value={item.customerNo} mono />
          <DetailRow label="No. Referensi" value={item.noRef} mono />
          <DetailRow label="Kode Bayar" value={item.paymentCode} mono />
          <DetailRow label="Token/SN" value={item.tokenNumber ?? item.serialNumber} mono />
          <DetailRow label="Provider" value={item.provider} />
          <DetailRow label="Denom" value={item.denom} />
          <DetailRow label="Keterangan" value={item.igrDesc} />
        </div>

        <Separator />

        {/* Financial summary */}
        <div className="space-y-1.5">
          {item.basePrice != null && (
            <DetailRow label="Harga Modal" value={formatRupiah(item.basePrice)} />
          )}
          {nominal != null && (
            <div className="grid grid-cols-[140px_1fr] gap-2 text-sm">
              <span className="text-muted-foreground">Harga Jual</span>
              <span className="font-semibold">{formatRupiah(nominal)}</span>
            </div>
          )}
          {item.adminFee != null && item.adminFee > 0 && (
            <DetailRow label="Biaya Admin" value={formatRupiah(item.adminFee)} />
          )}
          {profit != null && (
            <div className="grid grid-cols-[140px_1fr] gap-2 text-sm">
              <span className="text-muted-foreground">Profit</span>
              <span className={profit >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                {profit >= 0 ? "+" : ""}{formatRupiah(profit)}
              </span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface HistoryTableProps {
  items: HistoryPaymentItem[]
}

export function HistoryTable({ items }: HistoryTableProps) {
  const [selectedItem, setSelectedItem] = useState<HistoryPaymentItem | null>(null)

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Layanan</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead>Deskripsi</TableHead>
              <TableHead>Nominal</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  Tidak ada transaksi ditemukan
                </TableCell>
              </TableRow>
            ) : (
              items.map((item, idx) => {
                const rowId = item.trxId ?? `item-${idx}`
                const service = detectServiceType(item)
                const Icon = service.icon
                const nominal = getNominal(item)

                return (
                  <TableRow
                    key={rowId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedItem(item)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${service.bg}`}>
                          <Icon className={`h-4 w-4 ${service.text}`} />
                        </div>
                        <span className="font-semibold text-sm">{service.label}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDateTime(item.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      <p className="truncate">{buildDescription(item)}</p>
                    </TableCell>
                    <TableCell className="font-semibold whitespace-nowrap">
                      {nominal != null ? formatRupiah(nominal) : "-"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <TransactionDetailDialog
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
      />
    </>
  )
}

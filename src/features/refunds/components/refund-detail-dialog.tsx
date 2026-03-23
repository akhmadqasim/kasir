import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useTauriQuery } from "@/hooks/use-tauri-command"
import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import type { RefundDetailResult } from "../types"

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—"
  return dateFormatter.format(new Date(dateStr.replace(" ", "T") + "Z"))
}

const CONDITION_CONFIG: Record<string, { label: string; className: string }> = {
  good: {
    label: id.refund.conditionGood,
    className: "bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300",
  },
  damaged: {
    label: id.refund.conditionDamaged,
    className: "",
  },
  expired: {
    label: id.refund.conditionExpired,
    className: "bg-yellow-50 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  },
}

function getDifferenceColor(amount: number): string {
  if (amount > 0) return "text-green-600 dark:text-green-400"
  if (amount < 0) return "text-red-600 dark:text-red-400"
  return "text-muted-foreground"
}

interface RefundDetailDialogProps {
  refundId: number | null
  onClose: () => void
}

export function RefundDetailDialog({ refundId, onClose }: RefundDetailDialogProps) {
  const { data: detail, isLoading } = useTauriQuery<RefundDetailResult>(
    "get_refund_detail",
    { refundId },
    { enabled: !!refundId }
  )

  const isExchange = detail?.refund.refund_type === "exchange"

  return (
    <Dialog open={!!refundId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{id.refund.detail}</DialogTitle>
          <DialogDescription>
            {detail?.refund.refund_number ?? ""}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !detail ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : (
          <div className="-mx-4 max-h-[50vh] overflow-y-auto px-4">
            <div className="space-y-4">
              {/* Header info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">{id.refund.refundNumber}</p>
                  <p className="font-mono font-medium">{detail.refund.refund_number}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{id.refund.type}</p>
                  {detail.refund.refund_type === "exchange" ? (
                    <Badge className="bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                      {id.refund.typeExchange}
                    </Badge>
                  ) : (
                    <Badge variant="default">
                      {id.refund.typeRefund}
                    </Badge>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground">{id.refund.transactionReceipt}</p>
                  <p className="font-mono">{detail.transaction_receipt}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{id.refund.cashier}</p>
                  <p>{detail.cashier_name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{id.transactions.date}</p>
                  <p>{formatDate(detail.refund.created_at)}</p>
                </div>
                {detail.refund.reason && (
                  <div>
                    <p className="text-muted-foreground">{id.refund.reason}</p>
                    <p>{detail.refund.reason}</p>
                  </div>
                )}
              </div>

              <Separator />

              {/* Returned items */}
              <div>
                <h4 className="mb-2 text-sm font-medium">{id.refund.returnedItems}</h4>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{id.refund.productName}</TableHead>
                        <TableHead className="text-center">Qty</TableHead>
                        <TableHead className="text-right">{id.refund.price}</TableHead>
                        <TableHead className="text-right">{id.refund.subtotal}</TableHead>
                        <TableHead>{id.refund.condition}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.items.map((item) => {
                        const conditionCfg = CONDITION_CONFIG[item.condition ?? ""] ?? null
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="text-sm">{item.product_name}</TableCell>
                            <TableCell className="text-center tabular-nums">{item.quantity}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatRupiah(item.product_price)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatRupiah(item.subtotal)}</TableCell>
                            <TableCell>
                              {conditionCfg ? (
                                <Badge
                                  variant={item.condition === "damaged" ? "destructive" : "default"}
                                  className={conditionCfg.className}
                                >
                                  {conditionCfg.label}
                                </Badge>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Exchange items (only for exchange type) */}
              {isExchange && detail.exchange_items.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="mb-2 text-sm font-medium">{id.refund.replacementItems}</h4>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{id.refund.productName}</TableHead>
                            <TableHead className="text-center">Qty</TableHead>
                            <TableHead className="text-right">{id.refund.price}</TableHead>
                            <TableHead className="text-right">{id.refund.subtotal}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.exchange_items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="text-sm">{item.product_name}</TableCell>
                              <TableCell className="text-center tabular-nums">{item.quantity}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatRupiah(item.product_price)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatRupiah(item.subtotal)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </>
              )}

              <Separator />

              {/* Summary */}
              <div className="space-y-1 text-sm">
                <div className="flex justify-between font-semibold">
                  <span>{id.refund.totalRefund}</span>
                  <span className="tabular-nums">{formatRupiah(detail.refund.total_refund_amount)}</span>
                </div>
                {isExchange && (
                  <>
                    <div className="flex justify-between text-muted-foreground">
                      <span>{id.refund.totalExchange}</span>
                      <span className="tabular-nums">{formatRupiah(detail.refund.total_exchange_amount ?? 0)}</span>
                    </div>
                    <div className={`flex justify-between font-semibold ${getDifferenceColor(detail.refund.difference_amount ?? 0)}`}>
                      <span>{id.refund.difference}</span>
                      <span className="tabular-nums">{formatRupiah(detail.refund.difference_amount ?? 0)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{id.refund.cancel}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

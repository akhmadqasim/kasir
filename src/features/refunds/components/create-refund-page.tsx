import { useState, useMemo } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { ArrowLeft, Search, Trash2, Plus, Minus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useTauriQuery } from "@/hooks/use-tauri-command"
import { useDebounce } from "@/hooks/use-debounce"
import { useAuthStore } from "@/features/auth"
import { formatDateTime, formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import {
  isDiscountedLine,
  lineDiscountAmount,
  netAmountForQuantity,
  netLineAmount,
  netUnitAmount,
} from "@/features/transactions/line-amounts"
import type { TransactionItem } from "@/features/transactions/types"
import type { PaginatedProducts } from "@/features/products/types"
import {
  useRefundForm,
  CONDITION_LABELS,
  type Condition,
  type RefundItemState,
} from "../hooks/use-refund-form"

export function CreateRefundPage() {
  const { transactionId } = useParams<{ transactionId: string }>()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const [searchQuery, setSearchQuery] = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const debouncedSearch = useDebounce(searchQuery, 300)

  const {
    detail,
    refundableItems,
    nonRefundableItems,
    isLoading,
    itemStates,
    actionType,
    exchangeItems,
    reason,
    isSubmitting,
    selectedItems,
    totalRefund,
    totalExchange,
    difference,
    hasEarlierRefund,
    blockedReason,
    setReason,
    setActionType,
    updateItem,
    addExchangeItem,
    updateExchangeQty,
    removeExchangeItem,
    handleSubmit,
  } = useRefundForm({
    transactionId: transactionId ? Number(transactionId) : null,
    userId: user?.id ?? null,
    onSuccess: () => navigate(-1),
  })

  const searchArgs = useMemo(() => ({
    params: { query: debouncedSearch, page: 1, per_page: 5 },
  }), [debouncedSearch])

  const { data: searchResults } = useTauriQuery<PaginatedProducts>(
    "search_products",
    searchArgs,
    { enabled: actionType === "exchange" && debouncedSearch.length >= 2 }
  )

  if (isLoading || !detail) {
    return (
      <div className="grid h-full grid-cols-10 gap-4">
        <div className="col-span-4 flex flex-col gap-4 overflow-hidden rounded-xl border bg-card p-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="col-span-6 flex flex-col gap-4 overflow-hidden rounded-xl border bg-card p-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="grid h-full grid-cols-10 gap-4">
      {/* Left column: Transaction info + return items */}
      <div className="col-span-4 flex flex-col overflow-hidden rounded-xl border bg-card">
        {/* Header */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">{id.refund.title}</h1>
        </div>

        {/* Transaction info */}
        <div className="border-b px-4 py-3">
          <div className="rounded-lg border bg-default/50 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{detail.transaction.receipt_number}</span>
              <Badge variant="outline" className="text-xs">
                {detail.transaction.payment_method.toUpperCase()}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(detail.transaction.created_at)}
            </p>
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">Total</span>
              <span className="text-sm font-semibold tabular-nums">
                {formatRupiah(detail.transaction.total_amount)}
              </span>
            </div>
          </div>
        </div>

        {/* Return items list */}
        {blockedReason && (
          <div className="px-4 pt-3">
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {blockedReason}
            </p>
          </div>
        )}
        {hasEarlierRefund && (
          <div className="px-4 pt-3">
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
              Sebagian transaksi ini sudah pernah diretur. Jumlah maksimum di bawah
              masih memakai jumlah pembelian — sisa yang benar akan ditampilkan
              kalau jumlahnya kelebihan.
            </p>
          </div>
        )}
        <div className="px-4 pt-3 pb-1">
          <Label className="text-sm font-medium">{id.refund.refundItems}</Label>
        </div>
        <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
          <div className="space-y-3 pt-2">
            {refundableItems.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Tidak ada barang fisik yang bisa diretur pada transaksi ini.
              </p>
            )}
            {refundableItems.map((item) => (
              <RefundItemCard
                key={item.id}
                item={item}
                state={itemStates[item.id]}
                onUpdate={(updates) => updateItem(item.id, updates)}
              />
            ))}
            {nonRefundableItems.length > 0 && (
              <div className="rounded-lg border border-dashed p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Tidak bisa diretur (layanan PPOB)
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {nonRefundableItems.map((item) => (
                    <li key={item.id} className="text-xs text-muted-foreground">
                      {item.product_name} × {item.quantity}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right column: Action type + exchange + summary */}
      <div className="col-span-6 flex flex-col overflow-hidden rounded-xl border bg-card">
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 p-4">
            {/* Action type selector */}
            <div className="grid gap-2">
              <Label className="text-sm font-medium">{id.refund.actionType}</Label>
              <Select
                value={actionType}
                onValueChange={(v) => {
                  setActionType(v as "refund" | "exchange")
                  if (v !== "exchange") {
                    setSearchQuery("")
                  }
                }}
              >
                <SelectTrigger className="w-full max-w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="refund">{id.refund.actionRefund}</SelectItem>
                  <SelectItem value="exchange">{id.refund.actionExchange}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Exchange section */}
            {actionType === "exchange" && (
              <div className="space-y-4">
                <Separator />
                <Label className="text-sm font-medium">{id.refund.exchangeItems}</Label>

                {/* Product search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder={id.refund.searchProduct}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
                    className="pl-9"
                  />
                  {searchFocused && searchResults && searchResults.data.length > 0 && searchQuery.length >= 2 && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border bg-popover shadow-md">
                      {searchResults.data.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => {
                            addExchangeItem(product)
                            setSearchQuery("")
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-default"
                        >
                          <div className="grid gap-0.5">
                            <span className="font-medium">{product.name}</span>
                            <span className="text-xs text-muted-foreground">
                              Stok: {product.stock} {product.unit}
                            </span>
                          </div>
                          <span className="tabular-nums font-medium whitespace-nowrap">
                            {formatRupiah(product.sell_price)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Exchange items table */}
                {exchangeItems.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{id.refund.productName}</TableHead>
                        <TableHead className="w-[120px] text-center">Qty</TableHead>
                        <TableHead className="w-[110px] text-right">{id.refund.subtotal}</TableHead>
                        <TableHead className="w-[40px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exchangeItems.map((item) => (
                        <TableRow key={item.product_id}>
                          <TableCell className="whitespace-normal">
                            <div className="min-w-0">
                              <p className="font-medium leading-snug">{item.product_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatRupiah(item.sell_price)} / {item.unit}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => updateExchangeQty(item.product_id, item.quantity - 1)}
                                disabled={item.quantity <= 1}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-8 text-center font-medium tabular-nums">
                                {item.quantity}
                              </span>
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => updateExchangeQty(item.product_id, item.quantity + 1)}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatRupiah(item.sell_price * item.quantity)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => removeExchangeItem(item.product_id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}

            {/* Reason */}
            <div className="space-y-4">
              <Separator />
              <div className="grid gap-2">
                <Label htmlFor="refund-reason">{id.refund.reason}</Label>
                <Textarea
                  id="refund-reason"
                  placeholder={id.refund.reasonPlaceholder}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            {/* Info notes */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">• {id.refund.stockRestoredNote}</p>
              <p className="text-xs text-muted-foreground">• {id.refund.stockWriteoffNote}</p>
            </div>
          </div>
        </ScrollArea>

        {/* Summary + action (pinned to bottom) */}
        <div className="mt-auto border-t p-4 space-y-4">
          <div className="rounded-lg border bg-default/50 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{id.refund.totalRefund}</span>
              <span className="text-sm font-medium tabular-nums">
                {formatRupiah(totalRefund)}
              </span>
            </div>

            {actionType === "exchange" && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{id.refund.totalExchange}</span>
                  <span className="text-sm font-medium tabular-nums">
                    {formatRupiah(totalExchange)}
                  </span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{id.refund.difference}</span>
                  <div className="text-right">
                    <span className={`text-xl font-bold tabular-nums ${difference >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatRupiah(Math.abs(difference))}
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {difference >= 0 ? id.refund.differenceStoreReturns : id.refund.differenceCustomerPays}
                    </p>
                  </div>
                </div>
              </>
            )}

            {actionType === "refund" && totalRefund > 0 && (
              <div className="flex items-center justify-between pt-1 border-t">
                <span className="text-sm font-medium">{id.refund.totalRefund}</span>
                <span className="text-xl font-bold tabular-nums text-green-600">
                  {formatRupiah(totalRefund)}
                </span>
              </div>
            )}

            {selectedItems.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedItems.length} item diretur
                {actionType === "exchange" && exchangeItems.length > 0 && `, ${exchangeItems.length} item pengganti`}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => navigate(-1)}
              disabled={isSubmitting}
            >
              {id.refund.cancel}
            </Button>
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={
                isSubmitting ||
                blockedReason !== null ||
                selectedItems.length === 0 ||
                (actionType === "exchange" && exchangeItems.length === 0)
              }
            >
              {isSubmitting
                ? "Memproses..."
                : actionType === "exchange"
                  ? id.refund.confirmExchange
                  : id.refund.confirmRefund}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RefundItemCard({
  item,
  state,
  onUpdate,
}: {
  item: TransactionItem
  state: RefundItemState | undefined
  onUpdate: (updates: Partial<RefundItemState>) => void
}) {
  if (!state) return null

  const itemId = `refund-item-${item.id}`
  const isFullyRefunded = state.maxQty <= 0

  return (
    <Label
      htmlFor={itemId}
      className={`flex items-start gap-4 rounded-lg border p-4 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 ${
        isFullyRefunded ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-default/50"
      }`}
    >
      <Checkbox
        id={itemId}
        checked={state.checked}
        disabled={isFullyRefunded}
        onCheckedChange={(checked) => onUpdate({ checked: checked === true })}
        className="mt-0.5"
      />

      <div className="grid flex-1 gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-0.5">
            <span className="text-sm font-medium leading-none">{item.product_name}</span>
            <span className="text-xs text-muted-foreground">
              {formatRupiah(netUnitAmount(item))} × {item.quantity} ={" "}
              {formatRupiah(netLineAmount(item))}
            </span>
            {isDiscountedLine(item) && (
              <span className="text-xs text-muted-foreground">
                Harga daftar {formatRupiah(item.product_price)}, sudah dipotong diskon{" "}
                {formatRupiah(lineDiscountAmount(item))}
              </span>
            )}
            {isFullyRefunded && (
              <span className="text-xs text-muted-foreground">
                Sudah diretur seluruhnya
              </span>
            )}
          </div>
          {state.checked && (
            <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
              {formatRupiah(netAmountForQuantity(item, state.quantity))}
            </span>
          )}
        </div>

        {state.checked && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`qty-${item.id}`} className="text-xs text-muted-foreground">
                {id.refund.refundQty} (maks. {state.maxQty})
              </Label>
              <Input
                id={`qty-${item.id}`}
                type="number"
                min={1}
                max={state.maxQty}
                value={state.quantity}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(state.maxQty, Number(e.target.value) || 1))
                  onUpdate({ quantity: val })
                }}
                className="w-20 h-8 text-center"
              />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">{id.refund.condition}</Label>
              <Select
                value={state.condition}
                onValueChange={(v) => onUpdate({ condition: v as Condition })}
              >
                <SelectTrigger className="w-full max-w-32 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="good">{CONDITION_LABELS.good}</SelectItem>
                  <SelectItem value="damaged">{CONDITION_LABELS.damaged}</SelectItem>
                  <SelectItem value="expired">{CONDITION_LABELS.expired}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>
    </Label>
  )
}

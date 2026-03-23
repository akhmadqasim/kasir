import { useState, useMemo, useCallback, useEffect } from "react"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
import { Search, Trash2, Plus, Minus } from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
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
import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import type { TransactionDetail, TransactionItem } from "@/features/transactions/types"
import type { Product, PaginatedProducts } from "@/features/products/types"
import type { CreateRefundInput, RefundResult } from "../types"

type Condition = "good" | "damaged" | "expired"
type ActionType = "refund" | "exchange"

interface RefundItemState {
  checked: boolean
  quantity: number
  condition: Condition
  maxQty: number
}

interface ExchangeItem {
  product_id: number
  product_name: string
  sell_price: number
  quantity: number
  unit: string
}

interface RefundDialogProps {
  transactionId: number | null
  onClose: () => void
  onSuccess: () => void
}

const CONDITION_LABELS: Record<Condition, string> = {
  good: id.refund.conditionGood,
  damaged: id.refund.conditionDamaged,
  expired: id.refund.conditionExpired,
}

export function RefundDialog({ transactionId, onClose, onSuccess }: RefundDialogProps) {
  const user = useAuthStore((s) => s.user)
  const [reason, setReason] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [itemStates, setItemStates] = useState<Record<number, RefundItemState>>({})
  const [actionType, setActionType] = useState<ActionType>("refund")
  const [exchangeItems, setExchangeItems] = useState<ExchangeItem[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const debouncedSearch = useDebounce(searchQuery, 300)

  const { data: detail, isLoading } = useTauriQuery<TransactionDetail>(
    "get_transaction_detail",
    { transactionId },
    { enabled: !!transactionId }
  )

  const searchArgs = useMemo(() => ({
    params: { query: debouncedSearch, page: 1, per_page: 5 }
  }), [debouncedSearch])

  const { data: searchResults } = useTauriQuery<PaginatedProducts>(
    "search_products",
    searchArgs,
    { enabled: actionType === "exchange" && debouncedSearch.length >= 2 }
  )

  useEffect(() => {
    if (!detail) return
    const states: Record<number, RefundItemState> = {}
    for (const item of detail.items) {
      states[item.id] = {
        checked: false,
        quantity: item.quantity,
        condition: "good",
        maxQty: item.quantity,
      }
    }
    setItemStates(states)
    setReason("")
    setActionType("refund")
    setExchangeItems([])
    setSearchQuery("")
  }, [detail])

  const updateItem = useCallback((itemId: number, updates: Partial<RefundItemState>) => {
    setItemStates((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...updates },
    }))
  }, [])

  const addExchangeItem = useCallback((product: Product) => {
    setExchangeItems((prev) => {
      const existing = prev.find((i) => i.product_id === product.id)
      if (existing) {
        return prev.map((i) =>
          i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i
        )
      }
      return [...prev, {
        product_id: product.id,
        product_name: product.name,
        sell_price: product.sell_price,
        quantity: 1,
        unit: product.unit,
      }]
    })
    setSearchQuery("")
  }, [])

  const updateExchangeQty = useCallback((productId: number, qty: number) => {
    setExchangeItems((prev) =>
      prev.map((i) => i.product_id === productId ? { ...i, quantity: Math.max(1, qty) } : i)
    )
  }, [])

  const removeExchangeItem = useCallback((productId: number) => {
    setExchangeItems((prev) => prev.filter((i) => i.product_id !== productId))
  }, [])

  const selectedItems = useMemo(() => {
    if (!detail) return []
    return detail.items.filter((item) => itemStates[item.id]?.checked)
  }, [detail, itemStates])

  const totalRefund = useMemo(() => {
    return selectedItems.reduce((sum, item) => {
      const state = itemStates[item.id]
      return sum + item.product_price * (state?.quantity ?? 0)
    }, 0)
  }, [selectedItems, itemStates])

  const totalExchange = useMemo(() => {
    return exchangeItems.reduce((sum, item) => sum + item.sell_price * item.quantity, 0)
  }, [exchangeItems])

  const difference = totalRefund - totalExchange

  const handleSubmit = async () => {
    if (!transactionId || !user) return

    if (selectedItems.length === 0) {
      toast.error(id.refund.noItemsSelected)
      return
    }

    if (actionType === "exchange" && exchangeItems.length === 0) {
      toast.error(id.refund.noExchangeItems)
      return
    }

    setIsSubmitting(true)
    try {
      const refundInput: CreateRefundInput = {
        transaction_id: transactionId,
        user_id: user.id,
        reason: reason || undefined,
        items: selectedItems.map((item) => ({
          transaction_item_id: item.id,
          product_id: item.product_id,
          quantity: itemStates[item.id].quantity,
          condition: itemStates[item.id].condition,
        })),
        exchange_items: actionType === "exchange"
          ? exchangeItems.map((i) => ({ product_id: i.product_id, quantity: i.quantity }))
          : undefined,
      }

      await invoke<RefundResult>("create_refund", { input: refundInput })
      toast.success(actionType === "exchange" ? id.refund.exchangeSuccess : id.refund.refundSuccess)
      onSuccess()
      onClose()
    } catch (e) {
      toast.error(`${id.refund.refundFailed}: ${e}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={!!transactionId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{id.refund.title}</DialogTitle>
          <DialogDescription>
            {id.refund.stockRestoredNote}. {id.refund.stockWriteoffNote}.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !detail ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <>
            {/* Scrollable content */}
            <div className="-mx-4 max-h-[50vh] overflow-y-auto px-4 py-1">
              {/* Return items */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">{id.refund.refundItems}</Label>
                <div className="space-y-3">
                  {detail.items.map((item) => (
                    <RefundItemRow
                      key={item.id}
                      item={item}
                      state={itemStates[item.id]}
                      onUpdate={(updates) => updateItem(item.id, updates)}
                    />
                  ))}
                </div>
              </div>

              {/* Action type */}
              {selectedItems.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <div className="grid gap-2">
                    <Label className="text-sm font-medium">{id.refund.actionType}</Label>
                    <Select value={actionType} onValueChange={(v) => {
                      setActionType(v as ActionType)
                      if (v === "refund") {
                        setExchangeItems([])
                        setSearchQuery("")
                      }
                    }}>
                      <SelectTrigger className="w-full max-w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="refund">{id.refund.actionRefund}</SelectItem>
                        <SelectItem value="exchange">{id.refund.actionExchange}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {/* Exchange items */}
              {actionType === "exchange" && selectedItems.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <div className="space-y-3">
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
                              onClick={() => addExchangeItem(product)}
                              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
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
                            <TableHead className="w-[100px] text-center">Qty</TableHead>
                            <TableHead className="w-[90px] text-right">{id.refund.subtotal}</TableHead>
                            <TableHead className="w-[36px]" />
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
                </>
              )}
            </div>

            {/* Reason */}
            <Field>
              <Label htmlFor="refund-reason">{id.refund.reason}</Label>
              <Textarea
                id="refund-reason"
                placeholder={id.refund.reasonPlaceholder}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
            </Field>

            {/* Summary */}
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
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
              {actionType === "refund" && (
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
          </>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isSubmitting}>
              {id.refund.cancel}
            </Button>
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || selectedItems.length === 0 || (actionType === "exchange" && exchangeItems.length === 0)}
          >
            {isSubmitting
              ? "Memproses..."
              : actionType === "exchange"
                ? id.refund.confirmExchange
                : id.refund.confirmRefund}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RefundItemRow({
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

  return (
    <Label
      htmlFor={itemId}
      className={`flex cursor-pointer items-start gap-4 rounded-lg border p-4 transition-colors hover:bg-accent/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5`}
    >
      <Checkbox
        id={itemId}
        checked={state.checked}
        onCheckedChange={(checked) => onUpdate({ checked: checked === true })}
        className="mt-0.5"
      />

      <div className="grid flex-1 gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-0.5">
            <span className="text-sm font-medium leading-none">{item.product_name}</span>
            <span className="text-xs text-muted-foreground">
              {formatRupiah(item.product_price)} × {item.quantity} = {formatRupiah(item.subtotal)}
            </span>
          </div>
          {state.checked && (
            <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
              {formatRupiah(item.product_price * state.quantity)}
            </span>
          )}
        </div>

        {state.checked && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`qty-${item.id}`} className="text-xs text-muted-foreground">
                {id.refund.refundQty}
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
                <SelectContent position="popper">
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


import { useParams, useNavigate } from "react-router-dom"
import { ArrowLeft, Trash2, Plus, Minus } from "lucide-react"
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Label,
  ListBox,
  NumberField,
  ScrollShadow,
  Select,
  Separator,
  Skeleton,
  Table,
  TextArea,
  TextField,
} from "@heroui/react"

import { ProductAutocomplete } from "@/components/product-autocomplete"
import { selectedText } from "@/components/selected-text"
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
import { differenceToneClass } from "../labels"
import {
  useRefundForm,
  CONDITION_LABELS,
  type Condition,
  type RefundItemState,
} from "../hooks/use-refund-form"

const CONDITION_OPTIONS: { key: Condition; label: string }[] = [
  { key: "good", label: CONDITION_LABELS.good },
  { key: "damaged", label: CONDITION_LABELS.damaged },
  { key: "expired", label: CONDITION_LABELS.expired },
]

const ACTION_OPTIONS = [
  { key: "refund", label: id.refund.actionRefund },
  { key: "exchange", label: id.refund.actionExchange },
] as const

export function CreateRefundPage() {
  const { transactionId } = useParams<{ transactionId: string }>()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

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

  if (isLoading || !detail) {
    return (
      <div className="grid h-full grid-cols-10 gap-4">
        <div className="col-span-4 flex flex-col gap-4 overflow-hidden rounded-xl border bg-surface p-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="col-span-6 flex flex-col gap-4 overflow-hidden rounded-xl border bg-surface p-4">
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
      <div className="col-span-4 flex flex-col overflow-hidden rounded-xl border bg-surface">
        {/* Header */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Button
            aria-label={id.common.back}
            className="shrink-0"
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">{id.refund.title}</h1>
        </div>

        {/* Transaction info */}
        <div className="border-b px-4 py-3">
          <div className="space-y-1 rounded-lg border bg-default/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{detail.transaction.receipt_number}</span>
              <Chip size="sm">{detail.transaction.payment_method.toUpperCase()}</Chip>
            </div>
            <p className="text-xs text-muted">{formatDateTime(detail.transaction.created_at)}</p>
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted">Total</span>
              <span className="text-sm font-semibold tabular-nums">
                {formatRupiah(detail.transaction.total_amount)}
              </span>
            </div>
          </div>
        </div>

        {/* Return items list */}
        {blockedReason && (
          <div className="px-4 pt-3">
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{blockedReason}</Alert.Description>
              </Alert.Content>
            </Alert>
          </div>
        )}
        {hasEarlierRefund && (
          <div className="px-4 pt-3">
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  Sebagian transaksi ini sudah pernah diretur. Jumlah maksimum di bawah masih
                  memakai jumlah pembelian — sisa yang benar akan ditampilkan kalau jumlahnya
                  kelebihan.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          </div>
        )}
        <div className="px-4 pt-3 pb-1">
          <p className="text-sm font-medium">{id.refund.refundItems}</p>
        </div>
        <ScrollShadow className="min-h-0 flex-1 px-4 pb-4">
          <div className="space-y-3 pt-2">
            {refundableItems.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted">
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
                <p className="text-xs font-medium text-muted">Tidak bisa diretur (layanan PPOB)</p>
                <ul className="mt-1.5 space-y-0.5">
                  {nonRefundableItems.map((item) => (
                    <li key={item.id} className="text-xs text-muted">
                      {item.product_name} × {item.quantity}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </ScrollShadow>
      </div>

      {/* Right column: Action type + exchange + summary */}
      <div className="col-span-6 flex flex-col overflow-hidden rounded-xl border bg-surface">
        <ScrollShadow className="min-h-0 flex-1">
          <div className="space-y-6 p-4">
            {/* Action type selector */}
            <Select
              className="max-w-56"
              value={actionType}
              onChange={(value) => setActionType(value === "exchange" ? "exchange" : "refund")}
            >
              <Label>{id.refund.actionType}</Label>
              <Select.Trigger>
                <Select.Value>{selectedText}</Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {ACTION_OPTIONS.map((option) => (
                    <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
                      <Label>{option.label}</Label>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>

            {/* Exchange section */}
            {actionType === "exchange" && (
              <div className="space-y-4">
                <Separator />

                {/* Product search — the picked product goes straight into the table
                    below, so the field always reports an empty selection. */}
                <ProductAutocomplete
                  label={id.refund.exchangeItems}
                  placeholder={id.refund.addExchangeItem}
                  searchPlaceholder={id.refund.searchProduct}
                  perPage={5}
                  value={null}
                  onSelect={(product) => {
                    if (product) addExchangeItem(product)
                  }}
                  renderDetail={(product) =>
                    `Stok: ${product.stock} ${product.unit} · ${formatRupiah(product.sell_price)}`
                  }
                />

                {/* Exchange items table */}
                {exchangeItems.length > 0 && (
                  <Table variant="secondary">
                    <Table.ScrollContainer>
                      <Table.Content aria-label={id.refund.exchangeItems}>
                        <Table.Header>
                          <Table.Column isRowHeader>{id.refund.productName}</Table.Column>
                          <Table.Column className="w-[140px] text-center">Qty</Table.Column>
                          <Table.Column className="w-[110px] text-right">
                            {id.refund.subtotal}
                          </Table.Column>
                          <Table.Column className="w-[56px]">
                            <span className="sr-only">Aksi</span>
                          </Table.Column>
                        </Table.Header>
                        <Table.Body>
                          {exchangeItems.map((item) => (
                            <Table.Row
                              key={item.product_id}
                              id={item.product_id}
                              textValue={item.product_name}
                            >
                              <Table.Cell className="whitespace-normal">
                                <div className="min-w-0">
                                  <p className="font-medium leading-snug">{item.product_name}</p>
                                  <p className="text-xs text-muted">
                                    {formatRupiah(item.sell_price)} / {item.unit}
                                  </p>
                                </div>
                              </Table.Cell>
                              <Table.Cell>
                                <div className="flex items-center justify-center gap-1">
                                  <Button
                                    aria-label="Kurangi jumlah"
                                    isDisabled={item.quantity <= 1}
                                    isIconOnly
                                    size="sm"
                                    variant="outline"
                                    onPress={() =>
                                      updateExchangeQty(item.product_id, item.quantity - 1)
                                    }
                                  >
                                    <Minus className="h-3 w-3" />
                                  </Button>
                                  <span className="w-8 text-center font-medium tabular-nums">
                                    {item.quantity}
                                  </span>
                                  <Button
                                    aria-label="Tambah jumlah"
                                    isIconOnly
                                    size="sm"
                                    variant="outline"
                                    onPress={() =>
                                      updateExchangeQty(item.product_id, item.quantity + 1)
                                    }
                                  >
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                </div>
                              </Table.Cell>
                              <Table.Cell className="text-right font-semibold tabular-nums">
                                {formatRupiah(item.sell_price * item.quantity)}
                              </Table.Cell>
                              <Table.Cell>
                                <Button
                                  aria-label={`Hapus ${item.product_name}`}
                                  className="text-muted hover:text-danger"
                                  isIconOnly
                                  size="sm"
                                  variant="ghost"
                                  onPress={() => removeExchangeItem(item.product_id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </Table.Cell>
                            </Table.Row>
                          ))}
                        </Table.Body>
                      </Table.Content>
                    </Table.ScrollContainer>
                  </Table>
                )}
              </div>
            )}

            {/* Reason */}
            <div className="space-y-4">
              <Separator />
              <TextField fullWidth value={reason} onChange={setReason}>
                <Label>{id.refund.reason}</Label>
                <TextArea placeholder={id.refund.reasonPlaceholder} rows={3} />
              </TextField>
            </div>

            {/* Info notes */}
            <div className="space-y-1">
              <p className="text-xs text-muted">• {id.refund.stockRestoredNote}</p>
              <p className="text-xs text-muted">• {id.refund.stockWriteoffNote}</p>
            </div>
          </div>
        </ScrollShadow>

        {/* Summary + action (pinned to bottom) */}
        <div className="mt-auto space-y-4 border-t p-4">
          <div className="space-y-2 rounded-lg border bg-default/50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">{id.refund.totalRefund}</span>
              <span className="text-sm font-medium tabular-nums">{formatRupiah(totalRefund)}</span>
            </div>

            {actionType === "exchange" && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">{id.refund.totalExchange}</span>
                  <span className="text-sm font-medium tabular-nums">
                    {formatRupiah(totalExchange)}
                  </span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{id.refund.difference}</span>
                  <div className="text-right">
                    <span
                      className={`text-xl font-bold tabular-nums ${differenceToneClass(difference)}`}
                    >
                      {formatRupiah(Math.abs(difference))}
                    </span>
                    <p className="text-xs text-muted">
                      {difference >= 0
                        ? id.refund.differenceStoreReturns
                        : id.refund.differenceCustomerPays}
                    </p>
                  </div>
                </div>
              </>
            )}

            {actionType === "refund" && totalRefund > 0 && (
              <div className="flex items-center justify-between border-t pt-1">
                <span className="text-sm font-medium">{id.refund.totalRefund}</span>
                <span className="text-xl font-bold tabular-nums text-success">
                  {formatRupiah(totalRefund)}
                </span>
              </div>
            )}

            {selectedItems.length > 0 && (
              <p className="text-xs text-muted">
                {selectedItems.length} item diretur
                {actionType === "exchange" &&
                  exchangeItems.length > 0 &&
                  `, ${exchangeItems.length} item pengganti`}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              className="flex-1"
              isDisabled={isSubmitting}
              variant="outline"
              onPress={() => navigate(-1)}
            >
              {id.refund.cancel}
            </Button>
            <Button
              className="flex-1"
              isDisabled={
                isSubmitting ||
                blockedReason !== null ||
                selectedItems.length === 0 ||
                (actionType === "exchange" && exchangeItems.length === 0)
              }
              onPress={handleSubmit}
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

  const isFullyRefunded = state.maxQty <= 0

  return (
    // Baris yang dicentang ditandai garis tepi warna merek dan permukaan netral.
    // `bg-default` dipakai, bukan tint dari `--accent`: nama itu berarti dua hal
    // berbeda di shadcn dan HeroUI, jadi seluruh aplikasi menghindarinya.
    <div
      className={`rounded-lg border p-4 transition-colors ${
        state.checked ? "border-accent bg-default" : ""
      } ${isFullyRefunded ? "opacity-60" : ""}`}
    >
      <Checkbox
        isDisabled={isFullyRefunded}
        isSelected={state.checked}
        onChange={(isSelected) => onUpdate({ checked: isSelected })}
      >
        <Checkbox.Content className="items-start gap-4">
          <Checkbox.Control className="mt-0.5">
            <Checkbox.Indicator />
          </Checkbox.Control>
          <div className="grid flex-1 gap-0.5 text-left">
            <span className="text-sm font-medium leading-none">{item.product_name}</span>
            <span className="text-xs text-muted">
              {formatRupiah(netUnitAmount(item))} × {item.quantity} ={" "}
              {formatRupiah(netLineAmount(item))}
            </span>
            {isDiscountedLine(item) && (
              <span className="text-xs text-muted">
                Harga daftar {formatRupiah(item.product_price)}, sudah dipotong diskon{" "}
                {formatRupiah(lineDiscountAmount(item))}
              </span>
            )}
            {isFullyRefunded && (
              <span className="text-xs text-muted">Sudah diretur seluruhnya</span>
            )}
          </div>
          {state.checked && (
            <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
              {formatRupiah(netAmountForQuantity(item, state.quantity))}
            </span>
          )}
        </Checkbox.Content>
      </Checkbox>

      {state.checked && (
        <div className="mt-3 flex flex-wrap items-end gap-4 pl-9">
          <NumberField
            className="w-32"
            maxValue={state.maxQty}
            minValue={1}
            value={state.quantity}
            onChange={(quantity) => {
              if (quantity === undefined || Number.isNaN(quantity)) return
              onUpdate({ quantity })
            }}
          >
            <Label className="text-xs text-muted">
              {id.refund.refundQty} (maks. {state.maxQty})
            </Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input className="text-center" />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>

          <Select
            className="w-36"
            value={state.condition}
            onChange={(value) => onUpdate({ condition: value as Condition })}
          >
            <Label className="text-xs text-muted">{id.refund.condition}</Label>
            <Select.Trigger>
              <Select.Value>{selectedText}</Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {CONDITION_OPTIONS.map((option) => (
                  <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
                    <Label>{option.label}</Label>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      )}
    </div>
  )
}

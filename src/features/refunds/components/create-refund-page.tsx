import { useParams, useNavigate } from "react-router-dom"
import { Trash2, Plus, Minus } from "lucide-react"
import {
  Alert,
  Button,
  Checkbox,
  Label,
  NumberField,
  ScrollShadow,
  Separator,
  Skeleton,
  Surface,
  Table,
  TextArea,
  TextField,
} from "@heroui/react"

import { InfoPanel } from "@/components/info-panel"
import { SubpageHeader } from "@/components/layout/subpage-header"
import { NoData } from "@/components/no-data"
import { OptionSelect } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import { ProductAutocomplete } from "@/components/product-autocomplete"
import { SummaryList, type SummaryItem } from "@/components/summary-list"
import { useAuthStore } from "@/features/auth"
import { formatDateTime, formatRupiah } from "@/lib/format"
import { paymentMethodLabel } from "@/lib/labels"
import { id } from "@/i18n/id"
import {
  isDiscountedLine,
  lineDiscountAmount,
  netAmountForQuantity,
  netLineAmount,
  netUnitAmount,
} from "@/features/transactions/line-amounts"
import type { TransactionItem } from "@/features/transactions/types"
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

/** Kelas kedua panel halaman: permukaan bertepi yang mengisi tinggi layar. */
const PANEL_CLASS = "flex min-h-0 flex-1 flex-col overflow-hidden border lg:flex-none"

/**
 * Susunan halaman sama dengan layar kasir: dua `Surface` bertumpuk di layar
 * sempit, berdampingan 4:6 dari `lg` ke atas.
 */
const PAGE_CLASS = "flex h-full flex-col gap-4 lg:grid lg:grid-cols-10"

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

  // Rute `/refund/:id` tidak ada di menu, jadi judulnya dipasang sendiri — DESIGN.md §5.1.
  const navbar = <SubpageHeader title={id.refund.title} onBack={() => navigate(-1)} />

  if (isLoading || !detail) {
    return (
      <div className={PAGE_CLASS}>
        {navbar}
        <Surface className={`${PANEL_CLASS} gap-4 p-4 lg:col-span-4`}>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </Surface>
        <Surface className={`${PANEL_CLASS} gap-4 p-4 lg:col-span-6`}>
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-48 w-full" />
        </Surface>
      </div>
    )
  }

  const summaryItems: SummaryItem[] = [
    { label: id.refund.totalRefund, value: formatRupiah(totalRefund) },
    ...(actionType === "exchange"
      ? [
          { label: id.refund.totalExchange, value: formatRupiah(totalExchange) },
          {
            label: id.refund.difference,
            value: formatRupiah(Math.abs(difference)),
            tone: difference > 0 ? "success" : difference < 0 ? "danger" : "strong",
          } satisfies SummaryItem,
        ]
      : []),
  ]

  return (
    <div className={PAGE_CLASS}>
      {navbar}

      {/* Kolom kiri: info transaksi + barang yang diretur */}
      <Surface className={`${PANEL_CLASS} lg:col-span-4`}>
        <div className="flex flex-col gap-3 p-4">
          <InfoPanel>
            <SummaryList
              items={[
                {
                  label: id.transactions.receiptNumber,
                  value: detail.transaction.receipt_number,
                  tone: "mono",
                },
                {
                  label: id.transactions.date,
                  value: formatDateTime(detail.transaction.created_at),
                },
                {
                  label: id.transactions.paymentMethod,
                  value: paymentMethodLabel(detail.transaction.payment_method),
                },
                {
                  label: id.transactions.totalAmount,
                  value: formatRupiah(detail.transaction.total_amount),
                  tone: "strong",
                },
              ]}
            />
          </InfoPanel>

          {blockedReason && (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{blockedReason}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}
          {hasEarlierRefund && (
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
          )}
        </div>

        <Separator />

        <p className="px-4 pt-3 text-sm font-medium">{id.refund.refundItems}</p>
        <ScrollShadow className="min-h-0 flex-1 px-4 pb-4">
          <div className="flex flex-col gap-3 pt-2">
            {refundableItems.length === 0 && (
              <NoData title="Tidak ada barang fisik yang bisa diretur pada transaksi ini." />
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
              <InfoPanel className="flex flex-col gap-1 text-muted">
                <p className="font-medium">Tidak bisa diretur (layanan PPOB)</p>
                <ul className="flex flex-col gap-0.5">
                  {nonRefundableItems.map((item) => (
                    <li key={item.id}>
                      {item.product_name} × {item.quantity}
                    </li>
                  ))}
                </ul>
              </InfoPanel>
            )}
          </div>
        </ScrollShadow>
      </Surface>

      {/* Kolom kanan: tipe aksi + barang pengganti + ringkasan */}
      <Surface className={`${PANEL_CLASS} lg:col-span-6`}>
        <ScrollShadow className="min-h-0 flex-1">
          <div className="flex flex-col gap-6 p-4">
            {/* Pemilih tipe aksi */}
            <OptionSelect
              className="max-w-56"
              label={id.refund.actionType}
              options={ACTION_OPTIONS}
              value={actionType}
              variant="secondary"
              onChange={(key) => setActionType(key === "exchange" ? "exchange" : "refund")}
            />

            {/* Bagian tukar barang */}
            {actionType === "exchange" && (
              <div className="flex flex-col gap-4">
                {/* Pencarian produk — produk terpilih langsung masuk tabel di bawah,
                    jadi kolomnya selalu melaporkan pilihan kosong. */}
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

                {/* Tabel barang pengganti */}
                {exchangeItems.length > 0 && (
                  <Table variant="secondary">
                    <Table.ScrollContainer>
                      <Table.Content aria-label={id.refund.exchangeItems} className="tabular-nums">
                        <Table.Header>
                          <Table.Column isRowHeader>{id.refund.productName}</Table.Column>
                          <Table.Column className="w-36 text-center">Qty</Table.Column>
                          <Table.Column className="w-28 text-right">
                            {id.refund.subtotal}
                          </Table.Column>
                          <Table.Column className="w-14">
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
                                    variant="tertiary"
                                    onPress={() =>
                                      updateExchangeQty(item.product_id, item.quantity - 1)
                                    }
                                  >
                                    <Minus />
                                  </Button>
                                  <span className="w-8 text-center font-medium">
                                    {item.quantity}
                                  </span>
                                  <Button
                                    aria-label="Tambah jumlah"
                                    isIconOnly
                                    size="sm"
                                    variant="tertiary"
                                    onPress={() =>
                                      updateExchangeQty(item.product_id, item.quantity + 1)
                                    }
                                  >
                                    <Plus />
                                  </Button>
                                </div>
                              </Table.Cell>
                              <Table.Cell className="text-right font-medium">
                                {formatRupiah(item.sell_price * item.quantity)}
                              </Table.Cell>
                              <Table.Cell>
                                <Button
                                  aria-label={`Hapus ${item.product_name}`}
                                  isIconOnly
                                  size="sm"
                                  variant="danger"
                                  onPress={() => removeExchangeItem(item.product_id)}
                                >
                                  <Trash2 />
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

            {/* Alasan */}
            <TextField fullWidth value={reason} variant="secondary" onChange={setReason}>
              <Label>{id.refund.reason}</Label>
              <TextArea placeholder={id.refund.reasonPlaceholder} rows={3} />
            </TextField>

            {/* Catatan */}
            <ul className="flex list-disc flex-col gap-1 ps-4 text-xs text-muted">
              <li>{id.refund.stockRestoredNote}</li>
              <li>{id.refund.stockWriteoffNote}</li>
            </ul>
          </div>
        </ScrollShadow>

        {/* Ringkasan + aksi, ditambatkan di bawah. Angkanya ukuran bawaan:
            DESIGN.md §3.4 tidak punya peran "selisih retur", dan yang membedakan
            arah uangnya adalah warna plus kalimat di bawahnya. */}
        <Separator />
        <div className="flex flex-col gap-4 p-4">
          <InfoPanel className="flex flex-col gap-2">
            <SummaryList items={summaryItems} />
            {actionType === "exchange" && (
              <p className="text-xs text-muted">
                {difference >= 0
                  ? id.refund.differenceStoreReturns
                  : id.refund.differenceCustomerPays}
              </p>
            )}
            {selectedItems.length > 0 && (
              <p className="text-xs text-muted">
                {selectedItems.length} item diretur
                {actionType === "exchange" &&
                  exchangeItems.length > 0 &&
                  `, ${exchangeItems.length} item pengganti`}
              </p>
            )}
          </InfoPanel>

          <div className="flex justify-end gap-2">
            <Button isDisabled={isSubmitting} variant="tertiary" onPress={() => navigate(-1)}>
              {id.refund.cancel}
            </Button>
            <PendingButton
              isDisabled={
                blockedReason !== null ||
                selectedItems.length === 0 ||
                (actionType === "exchange" && exchangeItems.length === 0)
              }
              isPending={isSubmitting}
              onPress={handleSubmit}
            >
              {actionType === "exchange" ? id.refund.confirmExchange : id.refund.confirmRefund}
            </PendingButton>
          </div>
        </div>
      </Surface>
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
    // Permukaan bertingkat di dalam panel; kotak centangnya sendiri yang
    // menandai baris terpilih, bukan garis tepi warna merek tambahan.
    <Surface className="p-3" variant="secondary">
      <Checkbox
        isDisabled={isFullyRefunded}
        isSelected={state.checked}
        variant="secondary"
        onChange={(isSelected) => onUpdate({ checked: isSelected })}
      >
        {/* Labelnya dua-tiga baris, jadi kontrolnya rata atas. */}
        <Checkbox.Content className="items-start">
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <div className="grid flex-1 gap-0.5 text-left">
            <span>{item.product_name}</span>
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
            <span className="tabular-nums whitespace-nowrap">
              {formatRupiah(netAmountForQuantity(item, state.quantity))}
            </span>
          )}
        </Checkbox.Content>
      </Checkbox>

      {state.checked && (
        // `ps-7` menyejajarkan kolom isian dengan teks label di sebelah kotak centang.
        <div className="mt-3 flex flex-wrap items-end gap-4 ps-7">
          <NumberField
            className="w-32"
            maxValue={state.maxQty}
            minValue={1}
            value={state.quantity}
            variant="secondary"
            onChange={(quantity) => {
              if (quantity === undefined || Number.isNaN(quantity)) return
              onUpdate({ quantity })
            }}
          >
            <Label>
              {id.refund.refundQty} (maks. {state.maxQty})
            </Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input className="text-center tabular-nums" />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>

          <OptionSelect
            className="w-36"
            label={id.refund.condition}
            options={CONDITION_OPTIONS}
            value={state.condition}
            variant="secondary"
            onChange={(key) => onUpdate({ condition: key as Condition })}
          />
        </div>
      )}
    </Surface>
  )
}

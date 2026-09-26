import { useParams } from "react-router-dom"
import {
  Button,
  Label,
  ScrollShadow,
  Separator,
  Skeleton,
  Surface,
  TextArea,
  TextField,
} from "@heroui/react"

import { InfoPanel } from "@/components/info-panel"
import { SubpageHeader } from "@/components/layout/subpage-header"
import { LoadError } from "@/components/load-error"
import { PendingButton } from "@/components/pending-button"
import { ProductAutocomplete } from "@/components/product-autocomplete"
import { SummaryList } from "@/components/summary-list"
import { useAuthStore } from "@/features/auth"
import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import { useGoBack } from "@/hooks/use-go-back"
import { useRefundForm } from "../hooks/use-refund-form"
import { refundTotalsSummary } from "../refund-summary"
import { ExchangeItemsTable } from "./exchange-items-table"
import { RefundActionToggle } from "./refund-action-toggle"
import { RefundSourcePanel } from "./refund-source-panel"

/** Where Back, Cancel and a finished refund go when the page was opened directly. */
const FALLBACK_PATH = "/transactions"

/** Kelas kedua panel halaman: permukaan bertepi yang mengisi tinggi layar. */
const PANEL_CLASS = "flex min-h-0 flex-1 flex-col overflow-hidden border lg:flex-none"

/**
 * Susunan halaman sama dengan layar kasir: dua `Surface` bertumpuk di layar
 * sempit, berdampingan 4:6 dari `lg` ke atas.
 */
const PAGE_CLASS = "flex h-full flex-col gap-4 lg:grid lg:grid-cols-10"

export function CreateRefundPage() {
  const { transactionId } = useParams<{ transactionId: string }>()
  const goBack = useGoBack(FALLBACK_PATH)
  const user = useAuthStore((s) => s.user)

  const {
    detail,
    refundableItems,
    nonRefundableItems,
    isLoading,
    isFetching,
    loadError,
    canRetryLoad,
    refetch,
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
    onSuccess: goBack,
  })

  // Rute `/refund/:id` tidak ada di menu, jadi judulnya dipasang sendiri — DESIGN.md §5.1.
  const navbar = <SubpageHeader title={id.refund.title} onBack={goBack} />

  if (!detail && !isLoading && loadError) {
    // Gagal memuat (atau alamatnya salah): tanpa cabang ini halaman berhenti
    // di kerangka selamanya, tanpa jalan keluar selain tombol kembali di navbar.
    return (
      <div className="flex h-full flex-col">
        {navbar}
        <Surface className="border">
          <LoadError
            isRetrying={isFetching}
            secondaryAction={
              <Button size="sm" variant="tertiary" onPress={goBack}>
                {id.common.back}
              </Button>
            }
            title={id.loadFailed.transaction}
            onRetry={canRetryLoad ? () => void refetch() : undefined}
          >
            {loadError}
          </LoadError>
        </Surface>
      </div>
    )
  }

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

  const isExchange = actionType === "exchange"
  const summaryItems = refundTotalsSummary({
    isExchange,
    totalRefund,
    totalExchange,
    difference,
  })

  const submitHint =
    blockedReason !== null
      ? null
      : selectedItems.length === 0
        ? id.refund.selectItemsFirst
        : isExchange && exchangeItems.length === 0
          ? id.refund.addExchangeItemsFirst
          : null

  return (
    <div className={PAGE_CLASS}>
      {navbar}

      {/* Kolom kiri: info transaksi + barang yang diretur */}
      <RefundSourcePanel
        blockedReason={blockedReason}
        className={`${PANEL_CLASS} lg:col-span-4`}
        detail={detail}
        hasEarlierRefund={hasEarlierRefund}
        itemStates={itemStates}
        nonRefundableItems={nonRefundableItems}
        refundableItems={refundableItems}
        onUpdateItem={updateItem}
      />

      {/* Kolom kanan: tipe aksi + barang pengganti + ringkasan */}
      <Surface className={`${PANEL_CLASS} lg:col-span-6`}>
        <ScrollShadow className="min-h-0 flex-1">
          <div className="flex flex-col gap-6 p-4">
            <RefundActionToggle
              isDisabled={isSubmitting}
              value={actionType}
              onChange={setActionType}
            />

            {/* Bagian tukar barang */}
            {isExchange && (
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

                {exchangeItems.length > 0 && (
                  <ExchangeItemsTable
                    items={exchangeItems}
                    onQuantityChange={updateExchangeQty}
                    onRemove={removeExchangeItem}
                  />
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
            {selectedItems.length > 0 && (
              <p className="text-xs text-muted tabular-nums">
                {selectedItems.length} item diretur
                {isExchange &&
                  exchangeItems.length > 0 &&
                  `, ${exchangeItems.length} item pengganti`}
              </p>
            )}
          </InfoPanel>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Tombol proses yang mati harus bilang kenapa; alasan blokir tanggal
                sudah ada di panel kiri. */}
            {submitHint && (
              <p aria-live="polite" className="me-auto text-xs text-muted">
                {submitHint}
              </p>
            )}
            <Button isDisabled={isSubmitting} variant="tertiary" onPress={goBack}>
              {id.refund.cancel}
            </Button>
            <PendingButton
              isDisabled={
                blockedReason !== null ||
                selectedItems.length === 0 ||
                (isExchange && exchangeItems.length === 0)
              }
              isPending={isSubmitting}
              onPress={handleSubmit}
            >
              {isExchange ? id.refund.confirmExchange : id.refund.confirmRefund}
            </PendingButton>
          </div>
        </div>
      </Surface>
    </div>
  )
}

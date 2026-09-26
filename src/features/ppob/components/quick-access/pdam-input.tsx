import { useState } from "react"
import { Input, Label, Skeleton, TextField } from "@heroui/react"
import { Droplets } from "lucide-react"

import { LoadError } from "@/components/load-error"
import { OptionSelect } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { usePdamInquiry, usePdamProducts } from "../../hooks"
import { markupItem } from "./markup-item"
import { ServiceFlowLayout } from "./service-flow-layout"
import type { ServiceInputProps } from "./types"
import { useInquiryResult } from "./use-inquiry-result"
import { PpobSetupAction } from "../ppob-setup-action"

export function PdamInput({
  onAddToCart,
  resolveSellPrice,
  confirmLabel,
  wideLayout = false,
}: ServiceInputProps) {
  const [customerId, setCustomerId] = useState("")
  const [selectedPdam, setSelectedPdam] = useState("")
  const {
    data: pdamProducts,
    isLoading: pdamLoading,
    error: pdamError,
    refetch: refetchPdam,
    isFetching: pdamFetching,
  } = usePdamProducts()
  const pdamInquiry = usePdamInquiry()
  const { result: inquiryResult, reset: resetInquiry, accept: acceptInquiry } = useInquiryResult()

  const pdam = pdamProducts?.find((p) => p.plu === selectedPdam)
  const canInquiry = customerId.length >= 5 && !!selectedPdam

  const handleInquiry = () => {
    if (!canInquiry || pdamInquiry.isPending) return
    pdamInquiry.mutate(
      { customerId, productId: pdam?.id ?? 0, paymentCode: selectedPdam },
      {
        onSuccess: acceptInquiry(),
        onError: (err) => toast.error(id.ppob.billCheckFailed(err.message)),
      },
    )
  }

  // Yang dibayar toko ke vendor = tagihan + biaya admin.
  const vendorCost = inquiryResult?.total ?? 0
  const pdamName = pdam?.merchant ?? "PDAM"
  const itemName = `PDAM ${pdamName} - ${inquiryResult?.customerName ?? customerId}`
  const sellPrice = inquiryResult
    ? resolveSellPrice({ name: itemName, serviceType: "pdam", vendorCost })
    : 0

  const handleConfirm = () => {
    if (!inquiryResult) return
    onAddToCart({
      name: itemName,
      price: sellPrice,
      service_type: "pdam",
      service_ref: customerId,
      buy_price: vendorCost,
      ppob_product_id: pdam?.id,
      ppob_inquiry_id: inquiryResult.inquiryId,
      ppob_payment_code: selectedPdam,
    })
  }

  const confirmItems: SummaryItem[] | null = inquiryResult
    ? [
        { label: id.ppob.quickAccess.service, value: id.ppob.pdam },
        { label: id.ppob.quickAccess.customerId, value: customerId, tone: "mono" },
        { label: id.ppob.quickAccess.name, value: inquiryResult.customerName ?? "-" },
        { label: id.ppob.quickAccess.bill, value: formatRupiah(inquiryResult.amount) },
        { label: id.ppob.quickAccess.adminFee, value: formatRupiah(inquiryResult.adminFee) },
        ...(sellPrice > vendorCost ? [markupItem(sellPrice, vendorCost)] : []),
        { label: id.ppob.quickAccess.totalPay, value: formatRupiah(sellPrice), tone: "strong" },
      ]
    : null

  return (
    <ServiceFlowLayout
      confirmLabel={confirmLabel}
      confirmItems={confirmItems}
      placeholderIcon={<Droplets />}
      placeholderText={id.ppob.quickAccess.checkBillHint}
      wideLayout={wideLayout}
      onConfirm={handleConfirm}
    >
      {pdamLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : pdamError ? (
        <LoadError
          isRetrying={pdamFetching}
          secondaryAction={<PpobSetupAction error={pdamError} />}
          title={id.loadFailed.ppobPdam}
          onRetry={() => refetchPdam()}
        >
          {pdamError.message}
        </LoadError>
      ) : (
        <OptionSelect
          fullWidth
          label={id.ppob.pdam}
          options={pdamProducts?.map((p) => ({ key: p.plu, label: p.merchant })) ?? []}
          placeholder={id.ppob.quickAccess.pdamPlaceholder}
          value={selectedPdam || null}
          variant="secondary"
          onChange={(value) => {
            setSelectedPdam(value ?? "")
            resetInquiry()
          }}
        />
      )}

      <TextField
        fullWidth
        value={customerId}
        variant="secondary"
        onChange={(value) => {
          setCustomerId(value.replace(/\D/g, ""))
          resetInquiry()
        }}
      >
        <Label>{id.ppob.quickAccess.customerId}</Label>
        <Input
          className="tabular-nums"
          inputMode="numeric"
          placeholder={id.ppob.quickAccess.customerIdPlaceholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !inquiryResult) handleInquiry()
          }}
        />
      </TextField>

      {customerId && selectedPdam && !inquiryResult && (
        <PendingButton
          fullWidth
          isDisabled={!canInquiry}
          isPending={pdamInquiry.isPending}
          onPress={handleInquiry}
        >
          {id.ppob.quickAccess.checkBill}
        </PendingButton>
      )}
    </ServiceFlowLayout>
  )
}

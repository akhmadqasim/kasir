import { useState } from "react"
import { Input, Label, Skeleton, TextField, ToggleButton } from "@heroui/react"
import { Wallet } from "lucide-react"

import { LoadError } from "@/components/load-error"
import { PendingButton } from "@/components/pending-button"
import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { useEmoneyDenom, useEmoneyInquiry } from "../../hooks"
import { markupItem } from "./markup-item"
import { OptionGroup } from "./option-group"
import { ServiceFlowLayout } from "./service-flow-layout"
import type { ServiceInputProps } from "./types"
import { useInquiryResult } from "./use-inquiry-result"
import { PpobSetupAction } from "../ppob-setup-action"

export function EmoneyInput({
  onAddToCart,
  resolveSellPrice,
  confirmLabel,
  wideLayout = false,
}: ServiceInputProps) {
  const [phoneNumber, setPhoneNumber] = useState("")
  const [selectedDenom, setSelectedDenom] = useState<{ id: number; denom: string } | null>(null)
  const {
    data: denoms,
    isLoading,
    error: denomsError,
    refetch: refetchDenoms,
    isFetching: denomsFetching,
  } = useEmoneyDenom(1)
  const emoneyInquiry = useEmoneyInquiry()
  const { result: inquiryResult, reset: resetInquiry, accept: acceptInquiry } = useInquiryResult()
  const canInquiry = phoneNumber.length >= 8 && !!selectedDenom

  const handleInquiry = () => {
    if (!canInquiry || !selectedDenom || emoneyInquiry.isPending) return
    emoneyInquiry.mutate(
      { customerId: phoneNumber, productCode: selectedDenom.denom },
      {
        onSuccess: acceptInquiry(),
        onError: (err) => toast.error(id.ppob.customerCheckFailed(err.message)),
      },
    )
  }

  // Yang dibayar toko ke vendor = nominal + biaya admin.
  const vendorCost = inquiryResult?.total ?? 0
  const itemName = `E-Money ${selectedDenom?.denom ?? ""} - ${phoneNumber}`
  const sellPrice = inquiryResult
    ? resolveSellPrice({ name: itemName, serviceType: "emoney", vendorCost })
    : 0

  const handleConfirm = () => {
    if (!inquiryResult || !selectedDenom) return
    onAddToCart({
      name: itemName,
      price: sellPrice,
      service_type: "emoney",
      service_ref: phoneNumber,
      buy_price: vendorCost,
      ppob_inquiry_id: inquiryResult.inquiryId,
      ppob_product_code: selectedDenom.denom,
    })
  }

  const confirmItems: SummaryItem[] | null = inquiryResult
    ? [
        { label: id.ppob.quickAccess.service, value: id.ppob.emoney },
        { label: id.ppob.quickAccess.number, value: phoneNumber, tone: "mono" },
        {
          label: id.ppob.nominal,
          value: selectedDenom?.denom ? formatRupiah(parseFloat(selectedDenom.denom)) : "-",
        },
        ...(inquiryResult.adminFee > 0
          ? [{ label: id.ppob.quickAccess.adminFee, value: formatRupiah(inquiryResult.adminFee) }]
          : []),
        ...(sellPrice > vendorCost ? [markupItem(sellPrice, vendorCost)] : []),
        { label: id.ppob.quickAccess.totalPay, value: formatRupiah(sellPrice), tone: "strong" },
      ]
    : null

  return (
    <ServiceFlowLayout
      confirmLabel={confirmLabel}
      confirmItems={confirmItems}
      placeholderIcon={<Wallet />}
      placeholderText={id.ppob.quickAccess.checkCustomerHint}
      wideLayout={wideLayout}
      onConfirm={handleConfirm}
    >
      <TextField
        autoFocus
        fullWidth
        value={phoneNumber}
        variant="secondary"
        onChange={(value) => {
          setPhoneNumber(value.replace(/\D/g, ""))
          resetInquiry()
        }}
      >
        <Label>{id.ppob.quickAccess.emoneyId}</Label>
        <Input
          className="tabular-nums"
          inputMode="numeric"
          placeholder={id.ppob.quickAccess.emoneyIdPlaceholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !inquiryResult) handleInquiry()
          }}
        />
      </TextField>

      {isLoading && (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      )}

      {denomsError && (
        <LoadError
          isRetrying={denomsFetching}
          secondaryAction={<PpobSetupAction error={denomsError} />}
          title={id.loadFailed.ppobNominal}
          onRetry={() => refetchDenoms()}
        >
          {denomsError.message}
        </LoadError>
      )}

      {denoms && denoms.length > 0 && (
        <OptionGroup className="grid grid-cols-3 gap-2" label={id.ppob.nominal}>
          {denoms.map((d) => (
            <ToggleButton
              key={d.id}
              className="tabular-nums"
              isSelected={selectedDenom?.id === d.id}
              size="lg"
              onChange={() => {
                setSelectedDenom(d)
                resetInquiry()
              }}
            >
              {formatRupiah(parseFloat(d.denom))}
            </ToggleButton>
          ))}
        </OptionGroup>
      )}

      {phoneNumber && selectedDenom && !inquiryResult && (
        <PendingButton
          fullWidth
          isDisabled={!canInquiry}
          isPending={emoneyInquiry.isPending}
          onPress={handleInquiry}
        >
          {id.ppob.quickAccess.checkCustomer}
        </PendingButton>
      )}
    </ServiceFlowLayout>
  )
}

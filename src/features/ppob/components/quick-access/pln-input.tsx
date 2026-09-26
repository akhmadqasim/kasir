import { useState } from "react"
import {
  Description,
  Input,
  Label,
  Skeleton,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react"
import { Zap } from "lucide-react"

import { LoadError } from "@/components/load-error"
import { PendingButton } from "@/components/pending-button"
import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { usePlnDenom, usePlnInquiry } from "../../hooks"
import { markupItem } from "./markup-item"
import { OptionGroup } from "./option-group"
import { ServiceFlowLayout } from "./service-flow-layout"
import type { ServiceInputProps } from "./types"
import { useInquiryResult } from "./use-inquiry-result"
import { PpobSetupAction } from "../ppob-setup-action"

export function PlnInput({
  onAddToCart,
  resolveSellPrice,
  confirmLabel,
  wideLayout = false,
}: ServiceInputProps) {
  const [mode, setMode] = useState<"token" | "postpaid">("token")
  const [customerId, setCustomerId] = useState("")
  const [selectedDenom, setSelectedDenom] = useState<number | null>(null)
  const {
    data: denoms,
    isLoading: denomsLoading,
    error: denomsError,
    refetch: refetchDenoms,
    isFetching: denomsFetching,
  } = usePlnDenom()
  const plnInquiry = usePlnInquiry()
  const { result: inquiryResult, reset: resetInquiry, accept: acceptInquiry } = useInquiryResult()

  const handleModeChange = (newMode: string) => {
    setMode(newMode as "token" | "postpaid")
    setCustomerId("")
    setSelectedDenom(null)
    resetInquiry()
  }

  const canInquiry =
    mode === "token" ? customerId.length >= 8 && selectedDenom !== null : customerId.length >= 8

  const handleInquiry = () => {
    if (!canInquiry || plnInquiry.isPending) return
    const denom = mode === "token" ? denoms?.find((d) => d.id === selectedDenom) : null
    plnInquiry.mutate(
      {
        customerId,
        paymentCode: customerId,
        flagId: mode === "token" ? "0" : "1",
        amount: denom ? parseFloat(denom.denom) : 0,
      },
      {
        onSuccess: acceptInquiry(),
        onError: (err) =>
          toast.error(
            mode === "token"
              ? id.ppob.customerCheckFailed(err.message)
              : id.ppob.billCheckFailed(err.message),
          ),
      },
    )
  }

  // Yang dibayar toko ke vendor = tagihan + biaya admin.
  const vendorCost = inquiryResult?.total ?? 0
  const itemName = (() => {
    const label = mode === "token" ? "PLN Token" : "PLN Bayar"
    const customerName = inquiryResult?.customerName ?? customerId
    const denomLabel =
      mode === "token" && selectedDenom !== null
        ? ` ${formatRupiah(parseFloat(denoms?.find((d) => d.id === selectedDenom)?.denom ?? "0"))}`
        : ""
    return `${label}${denomLabel} - ${customerName}`
  })()
  const sellPrice = inquiryResult
    ? resolveSellPrice({ name: itemName, serviceType: "pln", vendorCost })
    : 0

  const handleConfirm = () => {
    if (!inquiryResult) return
    onAddToCart({
      name: itemName,
      price: sellPrice,
      service_type: "pln",
      service_ref: customerId,
      buy_price: vendorCost,
      ppob_inquiry_id: inquiryResult.inquiryId,
      ppob_payment_code: customerId,
      ppob_flag_id: mode === "token" ? "0" : "1",
    })
  }

  const plnInquiryData = inquiryResult?.rawData?.inquiry as Record<string, string> | undefined
  const confirmItems: SummaryItem[] | null = inquiryResult
    ? [
        {
          label: id.ppob.quickAccess.service,
          value:
            mode === "token"
              ? id.ppob.quickAccess.plnTokenService
              : id.ppob.quickAccess.plnPostpaidService,
        },
        { label: id.ppob.quickAccess.plnMeter, value: customerId, tone: "mono" },
        { label: id.ppob.quickAccess.name, value: inquiryResult.customerName ?? "-" },
        ...(plnInquiryData?.Golongan
          ? [
              {
                label: id.ppob.quickAccess.plnTariff,
                value: `${plnInquiryData.Golongan}/${plnInquiryData.Kategori ?? ""}`,
              },
            ]
          : []),
        {
          label: mode === "token" ? id.ppob.quickAccess.plnTokenPrice : id.ppob.quickAccess.bill,
          value: formatRupiah(inquiryResult.amount),
        },
        { label: id.ppob.quickAccess.adminFee, value: formatRupiah(inquiryResult.adminFee) },
        ...(sellPrice > vendorCost ? [markupItem(sellPrice, vendorCost)] : []),
        { label: id.ppob.quickAccess.totalPay, value: formatRupiah(sellPrice), tone: "strong" },
      ]
    : null

  const denomGridClass = `grid gap-2 ${wideLayout ? "grid-cols-4" : "grid-cols-3"}`

  return (
    <ServiceFlowLayout
      confirmItems={confirmItems}
      confirmLabel={confirmLabel}
      placeholderIcon={<Zap />}
      placeholderText={
        mode === "token" ? id.ppob.quickAccess.checkCustomerHint : id.ppob.quickAccess.checkBillHint
      }
      wideLayout={wideLayout}
      onConfirm={handleConfirm}
    >
      {/* Dua mode PLN, bukan dua panel: `ToggleButtonGroup` memberi `aria-pressed`
          tanpa menuntut `Tabs.Panel` yang isinya tidak ada. */}
      <ToggleButtonGroup
        aria-label={id.ppob.quickAccess.plnMode}
        fullWidth
        disallowEmptySelection
        selectedKeys={[mode]}
        selectionMode="single"
        onSelectionChange={(keys) => {
          const [next] = [...keys]
          if (next) handleModeChange(String(next))
        }}
      >
        <ToggleButton id="token">{id.ppob.quickAccess.plnToken}</ToggleButton>
        <ToggleButton id="postpaid">
          <ToggleButtonGroup.Separator />
          {id.ppob.quickAccess.plnPostpaid}
        </ToggleButton>
      </ToggleButtonGroup>

      <TextField
        autoFocus
        fullWidth
        value={customerId}
        variant="secondary"
        onChange={(value) => {
          setCustomerId(value.replace(/\D/g, ""))
          resetInquiry()
        }}
      >
        <Label>
          {mode === "token" ? id.ppob.quickAccess.plnMeter : id.ppob.quickAccess.customerId}
        </Label>
        {/* Enter mengecek, seperti pemindai yang menekan Enter setelah angkanya. */}
        <Input
          className="tabular-nums"
          inputMode="numeric"
          placeholder={
            mode === "token"
              ? id.ppob.quickAccess.plnMeterPlaceholder
              : id.ppob.quickAccess.plnIdpelPlaceholder
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && !inquiryResult) handleInquiry()
          }}
        />
        <Description>
          {mode === "token" ? id.ppob.quickAccess.plnMeterHint : id.ppob.quickAccess.plnIdpelHint}
        </Description>
      </TextField>

      {mode === "token" && denomsLoading && (
        <div className={denomGridClass}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      )}

      {mode === "token" && denomsError && (
        <LoadError
          isRetrying={denomsFetching}
          secondaryAction={<PpobSetupAction error={denomsError} />}
          title={id.loadFailed.ppobTokenNominal}
          onRetry={() => refetchDenoms()}
        >
          {denomsError.message}
        </LoadError>
      )}

      {mode === "token" && denoms && denoms.length > 0 && (
        <OptionGroup className={denomGridClass} label={id.ppob.nominal}>
          {denoms.map((d) => (
            <ToggleButton
              key={d.id}
              className="tabular-nums"
              isSelected={selectedDenom === d.id}
              size="lg"
              onChange={() => {
                setSelectedDenom(d.id)
                resetInquiry()
              }}
            >
              {formatRupiah(parseFloat(d.denom))}
            </ToggleButton>
          ))}
        </OptionGroup>
      )}

      {canInquiry && !inquiryResult && (
        <PendingButton fullWidth isPending={plnInquiry.isPending} onPress={handleInquiry}>
          {mode === "token" ? id.ppob.quickAccess.checkCustomer : id.ppob.quickAccess.checkBill}
        </PendingButton>
      )}
    </ServiceFlowLayout>
  )
}

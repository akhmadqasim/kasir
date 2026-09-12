import { useState } from "react"
import { Input, Label, TextField, ToggleButton, ToggleButtonGroup } from "@heroui/react"
import { HeartPulse } from "lucide-react"

import { PendingButton } from "@/components/pending-button"
import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import { useBpjsInquiry } from "../../hooks"
import type { InquiryResult } from "../../types"
import {
  BPJS_TYPE_OPTIONS,
  getBpjsDataBook,
  parseBpjsParticipants,
  type BpjsType,
} from "./bpjs-participants"
import { markupItem } from "./markup-item"
import { ServiceFlowLayout } from "./service-flow-layout"
import type { ServiceInputProps } from "./types"

export function BpjsInput({
  onAddToCart,
  resolveSellPrice,
  wideLayout = false,
}: ServiceInputProps) {
  const [customerId, setCustomerId] = useState("")
  const [bpjsType, setBpjsType] = useState<BpjsType>("BPJSKES")
  const bpjsInquiry = useBpjsInquiry()
  const [inquiryResult, setInquiryResult] = useState<InquiryResult | null>(null)
  const bpjsRawData = inquiryResult?.rawData as Record<string, unknown> | undefined
  const bpjsDataBook = getBpjsDataBook(bpjsRawData)
  const bpjsParticipants = parseBpjsParticipants(bpjsDataBook)
  const primaryParticipant =
    bpjsParticipants.find((participant) => participant.number === customerId) ?? bpjsParticipants[0]
  const displayCustomerName = primaryParticipant?.name ?? inquiryResult?.customerName ?? customerId
  const selectedBpjsType =
    BPJS_TYPE_OPTIONS.find((option) => option.value === bpjsType) ?? BPJS_TYPE_OPTIONS[0]
  const customerIdLabel = selectedBpjsType.value === "BPJSKES" ? "Nomor VA" : "Nomor Kartu"
  const customerIdPlaceholder =
    selectedBpjsType.value === "BPJSKES" ? "Masukkan nomor VA BPJS" : "Masukkan nomor kartu BPJS"
  const bpjsPaymentCode = (() => {
    const raw = inquiryResult?.rawData as
      | { data?: Record<string, unknown>; payment_code?: unknown }
      | undefined
    const fromData = raw?.data?.payment_code
    if (typeof fromData === "string" && fromData.length > 0) return fromData
    if (typeof raw?.payment_code === "string" && raw.payment_code.length > 0)
      return raw.payment_code
    return customerId
  })()

  const handleInquiry = () => {
    if (!customerId) return
    bpjsInquiry.mutate(
      {
        customerId,
        phoneNumber: "00",
        paymentCode: customerId,
        bpjsType: selectedBpjsType.value,
        period: "1",
      },
      {
        onSuccess: (result) => setInquiryResult(result),
        onError: (err) => toast.error(`Inquiry gagal: ${err.message}`),
      },
    )
  }

  // Yang dibayar toko ke vendor = tagihan + biaya admin.
  const vendorCost = inquiryResult?.total ?? 0
  const itemName = `${selectedBpjsType.serviceLabel} - ${displayCustomerName}${bpjsParticipants.length > 1 ? ` +${bpjsParticipants.length - 1} peserta` : ""}`
  const sellPrice = inquiryResult
    ? resolveSellPrice({ name: itemName, serviceType: "bpjs", vendorCost })
    : 0

  const handleConfirm = () => {
    if (!inquiryResult) return
    onAddToCart({
      name: itemName,
      price: sellPrice,
      service_type: "bpjs",
      service_ref: customerId,
      buy_price: vendorCost,
      ppob_product_code: selectedBpjsType.value,
      ppob_inquiry_id: inquiryResult.inquiryId,
      ppob_payment_code: bpjsPaymentCode,
      ppob_flag_id: "00",
    })
  }

  const confirmItems: SummaryItem[] | null = inquiryResult
    ? [
        { label: "Layanan", value: selectedBpjsType.serviceLabel },
        { label: customerIdLabel, value: customerId, tone: "mono" },
        { label: "Nama Utama", value: displayCustomerName },
        ...(bpjsParticipants.length > 1
          ? [{ label: "Jumlah Peserta", value: String(bpjsParticipants.length) }]
          : []),
        ...bpjsParticipants.map((participant, index) => ({
          label: `Peserta ${index + 1}`,
          value: participant.name || participant.number || "-",
        })),
        { label: "Tagihan", value: formatRupiah(inquiryResult.amount) },
        { label: "Admin", value: formatRupiah(inquiryResult.adminFee) },
        ...(sellPrice > vendorCost ? [markupItem(sellPrice, vendorCost)] : []),
        { label: "Total Bayar", value: formatRupiah(sellPrice), tone: "strong" },
      ]
    : null

  return (
    <ServiceFlowLayout
      confirmItems={confirmItems}
      placeholderIcon={<HeartPulse />}
      placeholderText="Cek tagihan untuk melihat detail"
      wideLayout={wideLayout}
      onConfirm={handleConfirm}
    >
      <ToggleButtonGroup
        aria-label="Jenis BPJS"
        fullWidth
        disallowEmptySelection
        selectedKeys={[bpjsType]}
        selectionMode="single"
        onSelectionChange={(keys) => {
          const [next] = [...keys]
          if (!next) return
          setBpjsType(next as BpjsType)
          setInquiryResult(null)
        }}
      >
        {BPJS_TYPE_OPTIONS.map((option, index) => (
          <ToggleButton key={option.value} id={option.value}>
            {index > 0 && <ToggleButtonGroup.Separator />}
            {option.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <TextField
        autoFocus
        fullWidth
        value={customerId}
        variant="secondary"
        onChange={(value) => {
          setCustomerId(value.replace(/\D/g, ""))
          setInquiryResult(null)
        }}
      >
        <Label>{customerIdLabel}</Label>
        <Input className="tabular-nums" inputMode="numeric" placeholder={customerIdPlaceholder} />
      </TextField>

      {!inquiryResult && (
        <PendingButton
          fullWidth
          isDisabled={customerId.length < 10}
          isPending={bpjsInquiry.isPending}
          onPress={handleInquiry}
        >
          Cek Tagihan
        </PendingButton>
      )}
    </ServiceFlowLayout>
  )
}

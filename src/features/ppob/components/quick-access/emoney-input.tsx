import { useState } from "react"
import { Input, Label, Skeleton, TextField, ToggleButton } from "@heroui/react"
import { Wallet } from "lucide-react"

import { PendingButton } from "@/components/pending-button"
import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import { useEmoneyDenom, useEmoneyInquiry } from "../../hooks"
import type { InquiryResult } from "../../types"
import { markupItem } from "./markup-item"
import { ServiceFlowLayout } from "./service-flow-layout"
import type { ServiceInputProps } from "./types"

export function EmoneyInput({
  onAddToCart,
  resolveSellPrice,
  confirmLabel,
  wideLayout = false,
}: ServiceInputProps) {
  const [phoneNumber, setPhoneNumber] = useState("")
  const [selectedDenom, setSelectedDenom] = useState<{ id: number; denom: string } | null>(null)
  const { data: denoms, isLoading } = useEmoneyDenom(1)
  const emoneyInquiry = useEmoneyInquiry()
  const [inquiryResult, setInquiryResult] = useState<InquiryResult | null>(null)

  const handleInquiry = () => {
    if (!phoneNumber || !selectedDenom) return
    emoneyInquiry.mutate(
      { customerId: phoneNumber, productCode: selectedDenom.denom },
      {
        onSuccess: (result) => setInquiryResult(result),
        onError: (err) => toast.error(`Inquiry gagal: ${err.message}`),
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
        { label: "Layanan", value: "E-Money" },
        { label: "Nomor", value: phoneNumber, tone: "mono" },
        {
          label: "Nominal",
          value: selectedDenom?.denom ? formatRupiah(parseFloat(selectedDenom.denom)) : "-",
        },
        ...(inquiryResult.adminFee > 0
          ? [{ label: "Admin", value: formatRupiah(inquiryResult.adminFee) }]
          : []),
        ...(sellPrice > vendorCost ? [markupItem(sellPrice, vendorCost)] : []),
        { label: "Total Bayar", value: formatRupiah(sellPrice), tone: "strong" },
      ]
    : null

  return (
    <ServiceFlowLayout
      confirmLabel={confirmLabel}
      confirmItems={confirmItems}
      placeholderIcon={<Wallet />}
      placeholderText="Cek nominal untuk melihat detail"
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
          setSelectedDenom(null)
          setInquiryResult(null)
        }}
      >
        <Label>Nomor HP / ID</Label>
        <Input className="tabular-nums" inputMode="numeric" placeholder="Masukkan nomor" />
      </TextField>

      {isLoading && (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      )}

      {denoms && denoms.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Nominal</p>
          <div className="grid grid-cols-3 gap-2">
            {denoms.map((d) => (
              <ToggleButton
                key={d.id}
                className="tabular-nums"
                isSelected={selectedDenom?.id === d.id}
                size="lg"
                onChange={() => {
                  setSelectedDenom(d)
                  setInquiryResult(null)
                }}
              >
                {formatRupiah(parseFloat(d.denom))}
              </ToggleButton>
            ))}
          </div>
        </div>
      )}

      {phoneNumber && selectedDenom && !inquiryResult && (
        <PendingButton
          fullWidth
          isDisabled={phoneNumber.length < 8}
          isPending={emoneyInquiry.isPending}
          onPress={handleInquiry}
        >
          Cek & Proses
        </PendingButton>
      )}
    </ServiceFlowLayout>
  )
}

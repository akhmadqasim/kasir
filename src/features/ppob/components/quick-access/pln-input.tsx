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

import { PendingButton } from "@/components/pending-button"
import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import { usePlnDenom, usePlnInquiry } from "../../hooks"
import type { InquiryResult } from "../../types"
import { markupItem } from "./markup-item"
import { ServiceFlowLayout } from "./service-flow-layout"
import type { ServiceInputProps } from "./types"

export function PlnInput({ onAddToCart, resolveSellPrice, wideLayout = false }: ServiceInputProps) {
  const [mode, setMode] = useState<"token" | "postpaid">("token")
  const [customerId, setCustomerId] = useState("")
  const [selectedDenom, setSelectedDenom] = useState<number | null>(null)
  const { data: denoms, isLoading: denomsLoading } = usePlnDenom()
  const plnInquiry = usePlnInquiry()
  const [inquiryResult, setInquiryResult] = useState<InquiryResult | null>(null)

  const handleModeChange = (newMode: string) => {
    setMode(newMode as "token" | "postpaid")
    setCustomerId("")
    setSelectedDenom(null)
    setInquiryResult(null)
  }

  const handleInquiry = () => {
    if (!customerId) return
    if (mode === "token" && selectedDenom === null) return
    const denom = mode === "token" ? denoms?.find((d) => d.id === selectedDenom) : null
    plnInquiry.mutate(
      {
        customerId,
        paymentCode: customerId,
        flagId: mode === "token" ? "0" : "1",
        amount: denom ? parseFloat(denom.denom) : 0,
      },
      {
        onSuccess: (result) => setInquiryResult(result),
        onError: (err) => toast.error(`Inquiry gagal: ${err.message}`),
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

  const canInquiry =
    mode === "token" ? customerId.length >= 8 && selectedDenom !== null : customerId.length >= 8

  const plnInquiryData = inquiryResult?.rawData?.inquiry as Record<string, string> | undefined
  const confirmItems: SummaryItem[] | null = inquiryResult
    ? [
        { label: "Layanan", value: mode === "token" ? "PLN Token" : "PLN Pascabayar" },
        { label: "No. Meter/IDPEL", value: customerId, tone: "mono" },
        { label: "Nama", value: inquiryResult.customerName ?? "-" },
        ...(plnInquiryData?.Golongan
          ? [
              {
                label: "Tarif/Daya",
                value: `${plnInquiryData.Golongan}/${plnInquiryData.Kategori ?? ""}`,
              },
            ]
          : []),
        { label: "Harga Token", value: formatRupiah(inquiryResult.amount) },
        { label: "Admin", value: formatRupiah(inquiryResult.adminFee) },
        ...(sellPrice > vendorCost ? [markupItem(sellPrice, vendorCost)] : []),
        { label: "Total Bayar", value: formatRupiah(sellPrice), tone: "strong" },
      ]
    : null

  const denomGridClass = `grid gap-2 ${wideLayout ? "grid-cols-4" : "grid-cols-3"}`

  return (
    <ServiceFlowLayout
      confirmItems={confirmItems}
      placeholderIcon={<Zap />}
      placeholderText="Cek tagihan untuk melihat detail"
      wideLayout={wideLayout}
      onConfirm={handleConfirm}
    >
      {/* Dua mode PLN, bukan dua panel: `ToggleButtonGroup` memberi `aria-pressed`
          tanpa menuntut `Tabs.Panel` yang isinya tidak ada. */}
      <ToggleButtonGroup
        aria-label="Jenis layanan PLN"
        fullWidth
        disallowEmptySelection
        selectedKeys={[mode]}
        selectionMode="single"
        onSelectionChange={(keys) => {
          const [next] = [...keys]
          if (next) handleModeChange(String(next))
        }}
      >
        <ToggleButton id="token">Token (Prepaid)</ToggleButton>
        <ToggleButton id="postpaid">
          <ToggleButtonGroup.Separator />
          Bayar (Pascabayar)
        </ToggleButton>
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
        <Label>{mode === "token" ? "No. Meter / IDPEL" : "ID Pelanggan"}</Label>
        <Input
          className="tabular-nums"
          inputMode="numeric"
          placeholder={
            mode === "token" ? "Masukkan no. meter atau IDPEL" : "Masukkan ID pelanggan (12 digit)"
          }
        />
        <Description>
          {mode === "token"
            ? "Bisa pakai No. Meter (11 digit) atau IDPEL (12 digit) dari struk PLN."
            : "Gunakan ID Pelanggan 12 digit dari tagihan listrik."}
        </Description>
      </TextField>

      {mode === "token" && denomsLoading && (
        <div className={denomGridClass}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      )}

      {mode === "token" && denoms && denoms.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Nominal</p>
          <div className={denomGridClass}>
            {denoms.map((d) => (
              <ToggleButton
                key={d.id}
                className="tabular-nums"
                isSelected={selectedDenom === d.id}
                size="lg"
                onChange={() => {
                  setSelectedDenom(d.id)
                  setInquiryResult(null)
                }}
              >
                {formatRupiah(parseFloat(d.denom))}
              </ToggleButton>
            ))}
          </div>
        </div>
      )}

      {canInquiry && !inquiryResult && (
        <PendingButton fullWidth isPending={plnInquiry.isPending} onPress={handleInquiry}>
          {mode === "token" ? "Cek Info Pelanggan" : "Cek Tagihan"}
        </PendingButton>
      )}
    </ServiceFlowLayout>
  )
}

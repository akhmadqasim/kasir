import { useState } from "react"
import { Input, Label, ListBox, Select, Skeleton, TextField } from "@heroui/react"
import { Droplets } from "lucide-react"

import { PendingButton } from "@/components/pending-button"
import { selectedText } from "@/components/selected-text"
import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import { usePdamInquiry, usePdamProducts } from "../../hooks"
import type { InquiryResult } from "../../types"
import { markupItem } from "./markup-item"
import { ServiceFlowLayout } from "./service-flow-layout"
import type { ServiceInputProps } from "./types"

export function PdamInput({
  onAddToCart,
  resolveSellPrice,
  wideLayout = false,
}: ServiceInputProps) {
  const [customerId, setCustomerId] = useState("")
  const [selectedPdam, setSelectedPdam] = useState("")
  const { data: pdamProducts, isLoading: pdamLoading } = usePdamProducts()
  const pdamInquiry = usePdamInquiry()
  const [inquiryResult, setInquiryResult] = useState<InquiryResult | null>(null)

  const handleInquiry = () => {
    if (!customerId || !selectedPdam) return
    const pdam = pdamProducts?.find((p) => p.plu === selectedPdam)
    pdamInquiry.mutate(
      { customerId, productId: pdam?.id ?? 0, paymentCode: selectedPdam },
      {
        onSuccess: (result) => setInquiryResult(result),
        onError: (err) => toast.error(`Inquiry gagal: ${err.message}`),
      },
    )
  }

  // Yang dibayar toko ke vendor = tagihan + biaya admin.
  const vendorCost = inquiryResult?.total ?? 0
  const pdamName = pdamProducts?.find((p) => p.plu === selectedPdam)?.merchant ?? "PDAM"
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
      ppob_product_id: pdamProducts?.find((p) => p.plu === selectedPdam)?.id,
      ppob_inquiry_id: inquiryResult.inquiryId,
      ppob_payment_code: selectedPdam,
    })
  }

  const confirmItems: SummaryItem[] | null = inquiryResult
    ? [
        { label: "Layanan", value: "PDAM" },
        { label: "ID Pelanggan", value: customerId, tone: "mono" },
        { label: "Nama", value: inquiryResult.customerName ?? "-" },
        { label: "Tagihan", value: formatRupiah(inquiryResult.amount) },
        { label: "Admin", value: formatRupiah(inquiryResult.adminFee) },
        ...(sellPrice > vendorCost ? [markupItem(sellPrice, vendorCost)] : []),
        { label: "Total Bayar", value: formatRupiah(sellPrice), tone: "strong" },
      ]
    : null

  return (
    <ServiceFlowLayout
      confirmItems={confirmItems}
      placeholderIcon={<Droplets />}
      placeholderText="Cek tagihan untuk melihat detail"
      wideLayout={wideLayout}
      onConfirm={handleConfirm}
    >
      {pdamLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <Select
          fullWidth
          placeholder="-- Pilih PDAM --"
          value={selectedPdam || null}
          variant="secondary"
          onChange={(value) => {
            setSelectedPdam(value === null ? "" : String(value))
            setInquiryResult(null)
          }}
        >
          <Label>Pilih PDAM</Label>
          <Select.Trigger>
            <Select.Value>{selectedText}</Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {pdamProducts?.map((p) => (
                <ListBox.Item key={p.id} id={p.plu} textValue={p.merchant}>
                  <Label>{p.merchant}</Label>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      )}

      <TextField
        fullWidth
        value={customerId}
        variant="secondary"
        onChange={(value) => {
          setCustomerId(value.replace(/\D/g, ""))
          setInquiryResult(null)
        }}
      >
        <Label>ID Pelanggan</Label>
        <Input className="tabular-nums" inputMode="numeric" placeholder="Masukkan ID pelanggan" />
      </TextField>

      {customerId && selectedPdam && !inquiryResult && (
        <PendingButton
          fullWidth
          isDisabled={customerId.length < 5}
          isPending={pdamInquiry.isPending}
          onPress={handleInquiry}
        >
          Cek Tagihan
        </PendingButton>
      )}
    </ServiceFlowLayout>
  )
}

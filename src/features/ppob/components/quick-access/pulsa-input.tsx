import { useState } from "react"
import { Description, Input, Label, Skeleton, TextField, ToggleButton } from "@heroui/react"
import { Smartphone } from "lucide-react"

import { NoData } from "@/components/no-data"
import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import { usePulsaDetails } from "../../hooks"
import type { PulsaDetailProduct } from "../../types"
import { ServiceFlowLayout } from "./service-flow-layout"
import type { ServiceInputProps } from "./types"

interface PulsaInputProps extends ServiceInputProps {
  productType: "pulsa" | "data"
}

export function PulsaInput({
  onAddToCart,
  resolveSellPrice,
  productType,
  wideLayout = false,
}: PulsaInputProps) {
  const [phoneNumber, setPhoneNumber] = useState("")
  const [selected, setSelected] = useState<PulsaDetailProduct | null>(null)

  const { data, isLoading, error } = usePulsaDetails(phoneNumber)

  const filteredProducts =
    data?.products.filter((p) => {
      if (p.isTrouble !== 0) return false
      if (productType === "data")
        return (
          p.description.toLowerCase().includes("data") ||
          p.description.toLowerCase().includes("internet")
        )
      return (
        !p.description.toLowerCase().includes("data") &&
        !p.description.toLowerCase().includes("internet")
      )
    }) ?? []

  const buildItemName = (product: PulsaDetailProduct) =>
    `${productType === "pulsa" ? "Pulsa" : "Data"} ${data?.provider ?? ""} - ${product.description.replace(/\n/g, " ")}`

  const getSellPrice = (product: PulsaDetailProduct) =>
    resolveSellPrice({
      name: buildItemName(product),
      serviceType: productType,
      vendorCost: product.vendorPrice,
    })

  const selectedSellPrice = selected ? getSellPrice(selected) : 0

  const handleConfirm = () => {
    if (!selected || !phoneNumber) return
    onAddToCart({
      name: buildItemName(selected),
      price: selectedSellPrice,
      service_type: productType,
      service_ref: phoneNumber,
      buy_price: selected.vendorPrice,
      ppob_product_id: selected.id,
      ppob_product_code: selected.plu,
    })
  }

  const confirmItems: SummaryItem[] | null = selected
    ? [
        { label: "Layanan", value: productType === "pulsa" ? "Pulsa" : "Paket Data" },
        { label: "Provider", value: data?.provider ?? "-" },
        { label: "Nomor HP", value: phoneNumber, tone: "mono" },
        { label: "Produk", value: selected.description.replace(/\n/g, " ") },
        { label: "Modal", value: formatRupiah(selected.vendorPrice) },
        { label: "Harga Jual", value: formatRupiah(selectedSellPrice), tone: "strong" },
        {
          label: "Margin",
          value: `+${formatRupiah(selectedSellPrice - selected.vendorPrice)}`,
          tone: "success",
        },
      ]
    : null

  const productGridClass = `grid gap-2 ${wideLayout ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`

  return (
    <ServiceFlowLayout
      confirmItems={confirmItems}
      placeholderIcon={<Smartphone />}
      placeholderText="Pilih produk untuk melihat detail"
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
          setSelected(null)
        }}
      >
        <Label>Nomor HP</Label>
        <Input className="tabular-nums" inputMode="tel" placeholder="08xxxxxxxxxx" />
        {/* Provider yang terdeteksi jadi keterangan kolomnya. */}
        {data && (
          <Description className="flex items-center gap-1.5">
            {data.image && <img src={data.image} alt="" className="h-4" />}
            {data.provider}
          </Description>
        )}
      </TextField>

      {/*
        Also covers the 300 ms debounce before the lookup starts: without it the
        panel is blank between the last digit and the first skeleton.
      */}
      {phoneNumber.length >= 10 && !data && !error && (
        <div className={productGridClass}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}

      {error && phoneNumber.length >= 10 && <p className="text-sm text-danger">{error.message}</p>}

      {/*
        A lookup that comes back with nothing to sell — every product flagged as
        trouble, or none matching this tab — used to render literally nothing, so
        the screen looked stuck on the last skeleton frame.
      */}
      {data && !isLoading && filteredProducts.length === 0 && (
        <NoData
          title={`Tidak ada produk ${productType === "pulsa" ? "pulsa" : "paket data"} untuk nomor ini`}
        >
          {data.provider
            ? `Provider terdeteksi: ${data.provider}. Coba tab lain atau ulangi beberapa saat lagi.`
            : "Periksa kembali nomornya, atau coba lagi beberapa saat lagi."}
        </NoData>
      )}

      {filteredProducts.length > 0 && (
        <div className={productGridClass}>
          {filteredProducts.map((product) => {
            const isSelected = selected?.id === product.id
            const sellPrice = getSellPrice(product)
            return (
              <ToggleButton
                key={product.id}
                className="h-auto flex-col items-start gap-0.5 whitespace-normal p-3 text-left"
                isSelected={isSelected}
                onChange={() => setSelected(product)}
              >
                <span>{product.description.replace(/\n/g, " ")}</span>
                <span className="font-semibold tabular-nums">{formatRupiah(sellPrice)}</span>
                <span className="text-xs tabular-nums text-muted">
                  Modal: {formatRupiah(product.vendorPrice)}
                </span>
              </ToggleButton>
            )
          })}
        </div>
      )}
    </ServiceFlowLayout>
  )
}

import { useState } from "react"
import { Description, Input, Label, Skeleton, TextField, ToggleButton } from "@heroui/react"
import { Smartphone } from "lucide-react"

import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import { cn } from "@/lib/utils"
import { id } from "@/i18n/id"
import { usePulsaDetails } from "../../hooks"
import type { PulsaDetailProduct } from "../../types"
import { OptionGroup } from "./option-group"
import { ServiceFlowLayout } from "./service-flow-layout"
import type { ServiceInputProps } from "./types"
import { PpobSetupAction } from "../ppob-setup-action"

interface PulsaInputProps extends ServiceInputProps {
  productType: "pulsa" | "data"
}

export function PulsaInput({
  onAddToCart,
  resolveSellPrice,
  confirmLabel,
  productType,
  wideLayout = false,
}: PulsaInputProps) {
  const [phoneNumber, setPhoneNumber] = useState("")
  const [selected, setSelected] = useState<PulsaDetailProduct | null>(null)

  const { data, isLoading, isFetching, error, refetch } = usePulsaDetails(phoneNumber)

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
        {
          label: id.ppob.quickAccess.service,
          value: productType === "pulsa" ? id.ppob.pulsa : id.ppob.dataPacket,
        },
        { label: id.ppob.provider, value: data?.provider ?? "-" },
        { label: id.ppob.phoneNumber, value: phoneNumber, tone: "mono" },
        { label: id.ppob.product, value: selected.description.replace(/\n/g, " ") },
        { label: id.ppob.quickAccess.cost, value: formatRupiah(selected.vendorPrice) },
        { label: id.ppob.price, value: formatRupiah(selectedSellPrice), tone: "strong" },
        {
          label: id.ppob.margin,
          value: `+${formatRupiah(selectedSellPrice - selected.vendorPrice)}`,
          tone: "success",
        },
      ]
    : null

  const productGridClass = `grid gap-2 ${wideLayout ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`

  return (
    <ServiceFlowLayout
      confirmLabel={confirmLabel}
      confirmItems={confirmItems}
      placeholderIcon={<Smartphone />}
      placeholderText={id.ppob.quickAccess.pickProductHint}
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
        <Label>{id.ppob.phoneNumber}</Label>
        <Input
          className="tabular-nums"
          inputMode="tel"
          placeholder={id.ppob.quickAccess.phonePlaceholder}
        />
        {/* Provider yang terdeteksi jadi keterangan kolomnya. */}
        {data && (
          <Description className="flex items-center gap-1.5">
            {data.image && <img src={data.image} alt="" className="h-4" />}
            {data.provider}
          </Description>
        )}
      </TextField>

      {/* Before the number is long enough to look up, the panel under the field
          would be blank — say what to type and what will appear there. */}
      {phoneNumber.length < 10 && !data && (
        <NoData icon={<Smartphone />} title={id.ppob.quickAccess.enterPhoneTitle}>
          {productType === "pulsa"
            ? id.ppob.quickAccess.enterPhonePulsaHint
            : id.ppob.quickAccess.enterPhoneDataHint}
        </NoData>
      )}

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

      {error && phoneNumber.length >= 10 && (
        <LoadError
          isRetrying={isFetching}
          secondaryAction={<PpobSetupAction error={error} />}
          title={id.loadFailed.ppobProducts}
          onRetry={() => refetch()}
        >
          {error.message}
        </LoadError>
      )}

      {/*
        A lookup that comes back with nothing to sell — every product flagged as
        trouble, or none matching this tab — used to render literally nothing, so
        the screen looked stuck on the last skeleton frame.
      */}
      {data && !isLoading && filteredProducts.length === 0 && (
        <NoData
          title={
            productType === "pulsa"
              ? id.ppob.quickAccess.noPulsaProducts
              : id.ppob.quickAccess.noDataProducts
          }
        >
          {data.provider
            ? id.ppob.quickAccess.providerDetected(data.provider)
            : id.ppob.quickAccess.checkNumber}
        </NoData>
      )}

      {filteredProducts.length > 0 && (
        <OptionGroup
          className={productGridClass}
          label={
            productType === "pulsa" ? id.ppob.quickAccess.pickPulsa : id.ppob.quickAccess.pickData
          }
        >
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
                {/* `text-muted` only on the neutral tile: on the selected
                    accent-soft tile it drops below AA, so the line keeps the
                    tile's own foreground there. */}
                <span className={cn("text-xs tabular-nums", !isSelected && "text-muted")}>
                  {id.ppob.quickAccess.costOf(formatRupiah(product.vendorPrice))}
                </span>
              </ToggleButton>
            )
          })}
        </OptionGroup>
      )}
    </ServiceFlowLayout>
  )
}

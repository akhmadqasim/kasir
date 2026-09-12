import { useEffect, useState } from "react"
import { Button } from "@heroui/react"
import { ArrowLeft } from "lucide-react"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { id } from "@/i18n/id"
import { getPpobMarkup } from "@/lib/api/settings"
import { toast } from "@/lib/toast"
import { useCartStore } from "@/stores/cart-store"
import { DEFAULT_PPOB_MARKUP, resolvePpobSellPrice } from "../../pricing"
import {
  PPOB_SERVICE_COLORS,
  QUICK_ACCESS_SERVICES,
  QUICK_ACCESS_SERVICE_BY_KEY,
} from "../../constants"
import type { PpobMarkup, PpobMarkupConfig } from "../../types/auth"
import { ServiceGrid } from "../service-grid"
import { BpjsInput } from "./bpjs-input"
import { EmoneyInput } from "./emoney-input"
import { PdamInput } from "./pdam-input"
import { PlnInput } from "./pln-input"
import { PulsaInput } from "./pulsa-input"
import { SaldoBar } from "./saldo-bar"
import type { AddToCartItem, ResolveSellPrice, ServiceType } from "./types"

interface PpobQuickAccessProps {
  initialService?: ServiceType
  onBack?: () => void
  onItemAdded?: () => void
  showSaldoBar?: boolean
  wideLayout?: boolean
}

export function PpobQuickAccess({
  initialService,
  onBack,
  onItemAdded,
  showSaldoBar = true,
  wideLayout = false,
}: PpobQuickAccessProps = {}) {
  const [selectedService, setSelectedService] = useState<ServiceType | null>(initialService ?? null)
  const [markup, setMarkup] = useState<PpobMarkup | null>(null)
  const [customPrices, setCustomPrices] = useState<Record<string, number>>({})
  const addPpobItem = useCartStore((s) => s.addPpobItem)

  /**
   * The shop's PPOB markup, which is what turns the provider's cost into the
   * price on the counter.
   *
   * Fetched from the session-scoped `/settings/ppob/markup` endpoint rather
   * than `/settings`, which is admin-only. `/settings` used to be the only
   * source and 403'd for a cashier, silently falling back to
   * `DEFAULT_PPOB_MARKUP` — zero — so every top-up sold at cost.
   */
  useEffect(() => {
    getPpobMarkup()
      .then((markup) => {
        setMarkup(markup)
        if (markup.custom_prices) {
          setCustomPrices(markup.custom_prices)
        }
      })
      .catch(() => {})
  }, [])

  const getMarkupConfig = (serviceType: string): PpobMarkupConfig => {
    if (!markup) return DEFAULT_PPOB_MARKUP
    return (
      (markup as unknown as Record<string, PpobMarkupConfig>)[serviceType] ?? DEFAULT_PPOB_MARKUP
    )
  }

  const resolveSellPrice: ResolveSellPrice = ({ name, serviceType, vendorCost }) =>
    resolvePpobSellPrice({
      name,
      serviceType,
      vendorCost,
      markup: getMarkupConfig(serviceType),
      customPrices,
    })

  const handleAddToCart = (item: AddToCartItem) => {
    const vendorCost = item.buy_price ?? item.price
    const sellPrice = Math.max(item.price, vendorCost)

    addPpobItem({
      ...item,
      price: sellPrice,
      buy_price: vendorCost,
      sell_price: sellPrice,
      ppob_product_id: item.ppob_product_id,
      ppob_product_code: item.ppob_product_code,
      ppob_inquiry_id: item.ppob_inquiry_id,
      ppob_payment_code: item.ppob_payment_code,
      ppob_flag_id: item.ppob_flag_id,
    })
    toast.success(`${item.name} ditambahkan ke keranjang`)
    if (onItemAdded) {
      onItemAdded()
      return
    }
    setSelectedService(initialService ?? null)
  }

  if (selectedService) {
    const service = QUICK_ACCESS_SERVICE_BY_KEY[selectedService]
    const handleBack = () => {
      if (initialService || onBack) {
        onBack?.()
        return
      }
      setSelectedService(null)
    }
    const inputProps = { onAddToCart: handleAddToCart, resolveSellPrice, wideLayout }

    return (
      <div className="flex flex-col gap-4">
        {wideLayout ? (
          <SubpageHeader title={service.label} onBack={handleBack} />
        ) : (
          // Di panel kasir navbar milik halaman Kasir, jadi penanda langkahnya
          // tinggal di dalam panel: tombol kembali, ikon layanan, namanya.
          <div className="flex items-center gap-2">
            <Button
              isIconOnly
              aria-label={id.common.back}
              size="sm"
              variant="tertiary"
              onPress={handleBack}
            >
              <ArrowLeft />
            </Button>
            <service.icon
              aria-hidden="true"
              className={`size-4 ${PPOB_SERVICE_COLORS[service.key].text}`}
            />
            <p className="min-w-0 truncate text-sm font-medium">{service.label}</p>
          </div>
        )}

        {selectedService === "pulsa" && <PulsaInput {...inputProps} productType="pulsa" />}
        {selectedService === "data" && <PulsaInput {...inputProps} productType="data" />}
        {selectedService === "pln" && <PlnInput {...inputProps} />}
        {selectedService === "pdam" && <PdamInput {...inputProps} />}
        {selectedService === "bpjs" && <BpjsInput {...inputProps} />}
        {selectedService === "emoney" && <EmoneyInput {...inputProps} />}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {showSaldoBar && <SaldoBar />}
      <ServiceGrid
        compact
        services={QUICK_ACCESS_SERVICES}
        onSelect={(service) => setSelectedService(service.key)}
      />
    </div>
  )
}

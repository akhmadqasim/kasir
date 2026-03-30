import { useState, useEffect, useRef } from "react"
import {
  Smartphone,
  Zap,
  Droplets,
  HeartPulse,
  CreditCard,
  Wifi,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  RefreshCw,
  History,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  usePpobSaldo,
  usePulsaDetails,
  usePlnDenom,
  usePdamProducts,
  usePlnInquiry,
  usePdamInquiry,
  useBpjsInquiry,
  useEmoneyDenom,
  useEmoneyInquiry,
} from "@/features/ppob/hooks"
import type { PulsaDetailProduct, InquiryResult } from "@/features/ppob/types"
import type { PpobMarkup, PpobMarkupConfig } from "@/features/ppob/types/auth"
import type { AppSettings } from "@/features/settings/types"
import { useCartStore } from "../hooks/use-cart-store"
import { formatRupiah, getAddItemValidationError } from "../utils"

export type ServiceType = "pulsa" | "data" | "pln" | "pdam" | "bpjs" | "emoney"

const SERVICES: { type: ServiceType; label: string; icon: typeof Smartphone; color: string }[] = [
  { type: "pulsa", label: "Pulsa", icon: Smartphone, color: "text-blue-500" },
  { type: "data", label: "Data", icon: Wifi, color: "text-green-500" },
  { type: "pln", label: "PLN", icon: Zap, color: "text-yellow-500" },
  { type: "pdam", label: "PDAM", icon: Droplets, color: "text-cyan-500" },
  { type: "bpjs", label: "BPJS", icon: HeartPulse, color: "text-red-500" },
  { type: "emoney", label: "E-Money", icon: CreditCard, color: "text-purple-500" },
]

function calculateSellPrice(buyPrice: number, config: PpobMarkupConfig): number {
  if (config.value <= 0) return buyPrice
  if (config.type === "fixed") return buyPrice + config.value
  return Math.round(buyPrice * (1 + config.value / 100))
}

/** Extract nominal value from PPOB product name (e.g., "Pulsa 5000", "5K", "5.000") */
function extractNominal(name: string): number | null {
  // Match patterns like "5000", "5.000", "10000", "10.000", "100.000"
  const numMatch = name.match(/\b(\d{1,3}(?:\.\d{3})*)\b/)
  if (numMatch) {
    const val = parseInt(numMatch[1].replace(/\./g, ""), 10)
    if (val >= 1000 && val <= 1000000) return val
  }
  // Match patterns like "5K", "10K", "100K"
  const kMatch = name.match(/\b(\d+)[kK]\b/)
  if (kMatch) {
    const val = parseInt(kMatch[1], 10) * 1000
    if (val >= 1000 && val <= 1000000) return val
  }
  return null
}

const DEFAULT_MARKUP: PpobMarkupConfig = { type: "fixed", value: 0 }

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
  const [selectedService, setSelectedService] = useState<ServiceType | null>(
    initialService ?? null
  )
  const [markup, setMarkup] = useState<PpobMarkup | null>(null)
  const [customPrices, setCustomPrices] = useState<Record<string, number>>({})
  const items = useCartStore((s) => s.items)
  const addPpobItem = useCartStore((s) => s.addPpobItem)

  useEffect(() => {
    setSelectedService(initialService ?? null)
  }, [initialService])

  useEffect(() => {
    invoke<AppSettings>("get_app_settings")
      .then((settings) => {
        if (settings.ppob?.markup) {
          setMarkup(settings.ppob.markup)
          if (settings.ppob.markup.custom_prices) {
            setCustomPrices(settings.ppob.markup.custom_prices)
          }
        }
      })
      .catch(() => {})
  }, [])

  const getMarkupConfig = (serviceType: string): PpobMarkupConfig => {
    if (!markup) return DEFAULT_MARKUP
    return (markup as unknown as Record<string, PpobMarkupConfig>)[serviceType] ?? DEFAULT_MARKUP
  }

  const handleAddToCart = (item: {
    name: string
    price: number
    service_type: string
    service_ref: string
    buy_price?: number
    ppob_product_id?: number
    ppob_product_code?: string
    ppob_inquiry_id?: string
    ppob_payment_code?: string
  }) => {
    const validationError = getAddItemValidationError(items, "ppob")
    if (validationError) {
      toast.error(validationError)
      return
    }

    const buyPrice = item.buy_price ?? item.price

    // Priority: 1. Nominal-based custom price (pulsa), 2. Markup config, 3. Raw price
    let sellPrice: number
    const nominal = item.service_type === "pulsa" ? extractNominal(item.name) : null
    if (nominal && customPrices[String(nominal)] > 0) {
      sellPrice = customPrices[String(nominal)]
    } else {
      const markupConfig = getMarkupConfig(item.service_type)
      sellPrice = calculateSellPrice(buyPrice, markupConfig)
    }

    addPpobItem({
      ...item,
      buy_price: buyPrice,
      sell_price: sellPrice,
      ppob_product_id: item.ppob_product_id,
      ppob_product_code: item.ppob_product_code,
      ppob_inquiry_id: item.ppob_inquiry_id,
      ppob_payment_code: item.ppob_payment_code,
    })
    toast.success(`${item.name} ditambahkan ke keranjang`)
    if (onItemAdded) {
      onItemAdded()
      return
    }
    setSelectedService(initialService ?? null)
  }

  if (selectedService) {
    return (
      <div className="p-4">
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              if (initialService || onBack) {
                onBack?.()
                return
              }
              setSelectedService(null)
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            {(() => {
              const svc = SERVICES.find(s => s.type === selectedService)
              if (!svc) return null
              const Icon = svc.icon
              return <Icon className={`h-4 w-4 ${svc.color}`} />
            })()}
            <span className="text-sm font-medium">
              {SERVICES.find(s => s.type === selectedService)?.label}
            </span>
          </div>
        </div>

        {selectedService === "pulsa" && <PulsaInput onAddToCart={handleAddToCart} productType="pulsa" wideLayout={wideLayout} />}
        {selectedService === "data" && <PulsaInput onAddToCart={handleAddToCart} productType="data" wideLayout={wideLayout} />}
        {selectedService === "pln" && <PlnInput onAddToCart={handleAddToCart} wideLayout={wideLayout} />}
        {selectedService === "pdam" && <PdamInput onAddToCart={handleAddToCart} wideLayout={wideLayout} />}
        {selectedService === "bpjs" && <BpjsInput onAddToCart={handleAddToCart} wideLayout={wideLayout} />}
        {selectedService === "emoney" && <EmoneyInput onAddToCart={handleAddToCart} wideLayout={wideLayout} />}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      {showSaldoBar && <SaldoBar />}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {SERVICES.map(({ type, label, icon: Icon, color }) => (
          <Button
            key={type}
            variant="outline"
            className="h-auto flex-col gap-1.5 py-3"
            onClick={() => setSelectedService(type)}
          >
            <Icon className={`h-5 w-5 ${color}`} />
            <span className="text-xs font-medium">{label}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}

function SaldoBar() {
  const navigate = useNavigate()
  const { data, isLoading, error, refetch } = usePpobSaldo()

  return (
    <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-muted-foreground" />
        {isLoading ? (
          <Skeleton className="h-5 w-28" />
        ) : error ? (
          <span className="text-xs text-muted-foreground">Saldo tidak tersedia</span>
        ) : (
          <span className="text-sm font-semibold tabular-nums">
            Rp {data?.saldo.toLocaleString("id-ID") ?? "0"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => refetch()}
          title="Refresh saldo"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => navigate("/ppob/history")}
          title="Riwayat transaksi"
        >
          <History className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

// --- Pulsa / Data Input ---
function PulsaInput({
  onAddToCart,
  productType,
  wideLayout = false,
}: {
  onAddToCart: (item: {
    name: string
    price: number
    service_type: string
    service_ref: string
    buy_price?: number
    ppob_product_id?: number
    ppob_product_code?: string
  }) => void
  productType: "pulsa" | "data"
  wideLayout?: boolean
}) {
  const [phoneNumber, setPhoneNumber] = useState("")
  const [selected, setSelected] = useState<PulsaDetailProduct | null>(null)

  const { data, isLoading, error } = usePulsaDetails(phoneNumber)

  const filteredProducts = data?.products.filter((p) => {
    if (p.isTrouble !== 0) return false
    if (productType === "data") return p.description.toLowerCase().includes("data") || p.description.toLowerCase().includes("internet")
    return !p.description.toLowerCase().includes("data") && !p.description.toLowerCase().includes("internet")
  }) ?? []

  const handleConfirm = () => {
    if (!selected || !phoneNumber) return
    const sellPrice = selected.lastPrice ?? selected.basePrice
    onAddToCart({
      name: `${productType === "pulsa" ? "Pulsa" : "Data"} ${data?.provider ?? ""} - ${selected.description.replace(/\n/g, " ")}`,
      price: sellPrice,
      service_type: productType,
      service_ref: phoneNumber,
      buy_price: selected.vendorPrice,
      ppob_product_id: selected.id,
      ppob_product_code: selected.plu,
    })
  }

  const confirmItems = selected ? [
    { label: "Layanan", value: productType === "pulsa" ? "Pulsa" : "Paket Data" },
    { label: "Provider", value: data?.provider ?? "-" },
    { label: "Nomor HP", value: phoneNumber, mono: true },
    { label: "Produk", value: selected.description.replace(/\n/g, " ") },
    { label: "Harga Jual", value: formatRupiah(selected.lastPrice ?? selected.basePrice), bold: true },
    { label: "Margin", value: `+${formatRupiah((selected.lastPrice ?? selected.basePrice) - selected.vendorPrice)}`, green: true },
  ] : null

  const inputSection = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nomor HP</Label>
        <div className="relative">
          <Input
            type="tel"
            placeholder="08xxxxxxxxxx"
            value={phoneNumber}
            onChange={(e) => {
              setPhoneNumber(e.target.value.replace(/\D/g, ""))
              setSelected(null)
            }}
            className="font-mono pr-24 !text-xl h-12 tracking-wider"
            autoFocus
          />
          {data && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {data.image && <img src={data.image} alt={data.provider} className="h-5" />}
              <span className="text-xs font-medium text-muted-foreground">{data.provider}</span>
            </div>
          )}
        </div>
      </div>

      {isLoading && phoneNumber.length >= 10 && (
        <div className={`grid gap-2 ${wideLayout ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      )}

      {error && phoneNumber.length >= 10 && (
        <p className="text-sm text-destructive">{error.message}</p>
      )}

      {filteredProducts.length > 0 && (
        <div className={`grid gap-2 ${wideLayout ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}>
          {filteredProducts.map((product) => {
            const isSelected = selected?.id === product.id
            const sellPrice = product.lastPrice ?? product.basePrice
            return (
              <Card
                key={product.id}
                className={`cursor-pointer transition-colors ${isSelected ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
                onClick={() => setSelected(product)}
              >
                <CardContent className="p-3">
                  <p className="text-xs font-medium leading-tight">{product.description.replace(/\n/g, " ")}</p>
                  <p className="mt-1 text-sm font-bold">{formatRupiah(sellPrice)}</p>
                  <p className="text-[10px] text-muted-foreground">Modal: {formatRupiah(product.vendorPrice)}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {!wideLayout && confirmItems && (
        <>
          <Separator />
          <ConfirmSection items={confirmItems} onConfirm={handleConfirm} />
        </>
      )}
    </div>
  )

  if (wideLayout) {
    return (
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8">{inputSection}</div>
        <div className="col-span-4">
          <div className="sticky top-6">
            {confirmItems ? (
              <ConfirmSection items={confirmItems} onConfirm={handleConfirm} />
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                <Smartphone className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm">Pilih produk untuk melihat detail</p>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return inputSection
}

// --- PLN Input ---
function PlnInput({
  onAddToCart,
  wideLayout = false,
}: {
  onAddToCart: (item: {
    name: string
    price: number
    service_type: string
    service_ref: string
    buy_price?: number
    ppob_inquiry_id?: string
    ppob_payment_code?: string
  }) => void
  wideLayout?: boolean
}) {
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
    const denom = mode === "token" ? denoms?.find(d => d.id === selectedDenom) : null
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
      }
    )
  }

  const handleConfirm = () => {
    if (!inquiryResult) return
    const label = mode === "token" ? "PLN Token" : "PLN Bayar"
    const customerName = inquiryResult.customerName ?? customerId
    const denomLabel = mode === "token" && selectedDenom !== null
      ? ` ${formatRupiah(parseFloat(denoms?.find(d => d.id === selectedDenom)?.denom ?? "0"))}`
      : ""
    onAddToCart({
      name: `${label}${denomLabel} - ${customerName}`,
      price: inquiryResult.total,
      service_type: "pln",
      service_ref: customerId,
      buy_price: inquiryResult.amount,
      ppob_inquiry_id: inquiryResult.inquiryId,
      ppob_payment_code: customerId,
    })
  }

  const canInquiry = mode === "token"
    ? customerId.length >= 8 && selectedDenom !== null
    : customerId.length >= 8

  const plnInquiryData = inquiryResult?.rawData?.inquiry as Record<string, string> | undefined
  const confirmItems = inquiryResult ? [
    { label: "Layanan", value: mode === "token" ? "PLN Token" : "PLN Pascabayar" },
    { label: "No. Meter/IDPEL", value: customerId, mono: true },
    { label: "Nama", value: inquiryResult.customerName ?? "-" },
    ...(plnInquiryData?.Golongan ? [{ label: "Tarif/Daya", value: `${plnInquiryData.Golongan}/${plnInquiryData.Kategori ?? ""}` }] : []),
    { label: "Harga Token", value: formatRupiah(inquiryResult.amount) },
    { label: "Admin", value: formatRupiah(inquiryResult.adminFee) },
    { label: "Total", value: formatRupiah(inquiryResult.total), bold: true },
  ] : null

  const inputSection = (
    <div className="space-y-4">
      <Tabs value={mode} onValueChange={handleModeChange}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="token">Token (Prepaid)</TabsTrigger>
          <TabsTrigger value="postpaid">Bayar (Pascabayar)</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-2">
        <Label>{mode === "token" ? "No. Meter / IDPEL" : "ID Pelanggan"}</Label>
        <Input
          placeholder={mode === "token" ? "Masukkan no. meter atau IDPEL" : "Masukkan ID pelanggan (12 digit)"}
          value={customerId}
          onChange={(e) => { setCustomerId(e.target.value.replace(/\D/g, "")); setInquiryResult(null) }}
          className="font-mono !text-xl h-12 tracking-wider"
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          {mode === "token"
            ? "Bisa pakai No. Meter (11 digit) atau IDPEL (12 digit) dari struk PLN."
            : "Gunakan ID Pelanggan 12 digit dari tagihan listrik."
          }
        </p>
      </div>

      {mode === "token" && denomsLoading && (
        <div className={`grid gap-2 ${wideLayout ? "grid-cols-4" : "grid-cols-3"}`}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      )}

      {mode === "token" && denoms && denoms.length > 0 && (
        <div className="space-y-2">
          <Label>Nominal</Label>
          <div className={`grid gap-2 ${wideLayout ? "grid-cols-4" : "grid-cols-3"}`}>
            {denoms.map((d) => (
              <Button
                key={d.id}
                variant={selectedDenom === d.id ? "default" : "outline"}
                className="h-12 text-sm font-semibold"
                onClick={() => { setSelectedDenom(d.id); setInquiryResult(null) }}
              >
                {formatRupiah(parseFloat(d.denom))}
              </Button>
            ))}
          </div>
        </div>
      )}

      {canInquiry && !inquiryResult && (
        <Button className="w-full" onClick={handleInquiry} disabled={plnInquiry.isPending}>
          {plnInquiry.isPending
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {mode === "token" ? "Cek Info..." : "Cek Tagihan..."}</>
            : mode === "token" ? "Cek Info Pelanggan" : "Cek Tagihan"
          }
        </Button>
      )}

      {!wideLayout && confirmItems && (
        <>
          <Separator />
          <ConfirmSection items={confirmItems} onConfirm={handleConfirm} />
        </>
      )}
    </div>
  )

  if (wideLayout) {
    return (
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8">{inputSection}</div>
        <div className="col-span-4">
          <div className="sticky top-6">
            {confirmItems ? (
              <ConfirmSection items={confirmItems} onConfirm={handleConfirm} />
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                <Zap className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm">Cek tagihan untuk melihat detail</p>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return inputSection
}

// --- PDAM Input ---
function PdamInput({
  onAddToCart,
  wideLayout = false,
}: {
  onAddToCart: (item: {
    name: string
    price: number
    service_type: string
    service_ref: string
    buy_price?: number
    ppob_product_id?: number
    ppob_inquiry_id?: string
    ppob_payment_code?: string
  }) => void
  wideLayout?: boolean
}) {
  const [customerId, setCustomerId] = useState("")
  const [selectedPdam, setSelectedPdam] = useState("")
  const { data: pdamProducts, isLoading: pdamLoading } = usePdamProducts()
  const pdamInquiry = usePdamInquiry()
  const [inquiryResult, setInquiryResult] = useState<InquiryResult | null>(null)

  const handleInquiry = () => {
    if (!customerId || !selectedPdam) return
    const pdam = pdamProducts?.find(p => p.plu === selectedPdam)
    pdamInquiry.mutate(
      { customerId, productId: pdam?.id ?? 0, paymentCode: selectedPdam },
      {
        onSuccess: (result) => setInquiryResult(result),
        onError: (err) => toast.error(`Inquiry gagal: ${err.message}`),
      }
    )
  }

  const handleConfirm = () => {
    if (!inquiryResult) return
    const pdamName = pdamProducts?.find(p => p.plu === selectedPdam)?.merchant ?? "PDAM"
    onAddToCart({
      name: `PDAM ${pdamName} - ${inquiryResult.customerName ?? customerId}`,
      price: inquiryResult.total,
      service_type: "pdam",
      service_ref: customerId,
      buy_price: inquiryResult.amount,
      ppob_product_id: pdamProducts?.find(p => p.plu === selectedPdam)?.id,
      ppob_inquiry_id: inquiryResult.inquiryId,
      ppob_payment_code: selectedPdam,
    })
  }

  const confirmItems = inquiryResult ? [
    { label: "Layanan", value: "PDAM" },
    { label: "ID Pelanggan", value: customerId, mono: true },
    { label: "Nama", value: inquiryResult.customerName ?? "-" },
    { label: "Tagihan", value: formatRupiah(inquiryResult.amount) },
    { label: "Admin", value: formatRupiah(inquiryResult.adminFee) },
    { label: "Total", value: formatRupiah(inquiryResult.total), bold: true },
  ] : null

  const inputSection = (
    <div className="space-y-4">
      {pdamLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <div className="space-y-2">
          <Label>Pilih PDAM</Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={selectedPdam}
            onChange={(e) => { setSelectedPdam(e.target.value); setInquiryResult(null) }}
          >
            <option value="">-- Pilih PDAM --</option>
            {pdamProducts?.map((p) => (
              <option key={p.id} value={p.plu}>{p.merchant}</option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-2">
        <Label>ID Pelanggan</Label>
        <Input
          placeholder="Masukkan ID pelanggan"
          value={customerId}
          onChange={(e) => { setCustomerId(e.target.value.replace(/\D/g, "")); setInquiryResult(null) }}
          className="font-mono !text-xl h-12 tracking-wider"
        />
      </div>

      {customerId && selectedPdam && !inquiryResult && (
        <Button className="w-full" onClick={handleInquiry} disabled={pdamInquiry.isPending || customerId.length < 5}>
          {pdamInquiry.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cek Tagihan...</> : "Cek Tagihan"}
        </Button>
      )}

      {!wideLayout && confirmItems && (
        <>
          <Separator />
          <ConfirmSection items={confirmItems} onConfirm={handleConfirm} />
        </>
      )}
    </div>
  )

  if (wideLayout) {
    return (
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8">{inputSection}</div>
        <div className="col-span-4">
          <div className="sticky top-6">
            {confirmItems ? (
              <ConfirmSection items={confirmItems} onConfirm={handleConfirm} />
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                <Droplets className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm">Cek tagihan untuk melihat detail</p>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return inputSection
}

// --- BPJS Input ---
function BpjsInput({
  onAddToCart,
  wideLayout = false,
}: {
  onAddToCart: (item: {
    name: string
    price: number
    service_type: string
    service_ref: string
    buy_price?: number
    ppob_inquiry_id?: string
  }) => void
  wideLayout?: boolean
}) {
  const [customerId, setCustomerId] = useState("")
  const bpjsInquiry = useBpjsInquiry()
  const [inquiryResult, setInquiryResult] = useState<InquiryResult | null>(null)

  const handleInquiry = () => {
    if (!customerId) return
    bpjsInquiry.mutate(
      { customerId, phoneNumber: customerId, paymentCode: "", bpjsType: "1", period: "1" },
      {
        onSuccess: (result) => setInquiryResult(result),
        onError: (err) => toast.error(`Inquiry gagal: ${err.message}`),
      }
    )
  }

  const handleConfirm = () => {
    if (!inquiryResult) return
    onAddToCart({
      name: `BPJS - ${inquiryResult.customerName ?? customerId}`,
      price: inquiryResult.total,
      service_type: "bpjs",
      service_ref: customerId,
      buy_price: inquiryResult.amount,
      ppob_inquiry_id: inquiryResult.inquiryId,
    })
  }

  const confirmItems = inquiryResult ? [
    { label: "Layanan", value: "BPJS Kesehatan" },
    { label: "No. BPJS", value: customerId, mono: true },
    { label: "Nama", value: inquiryResult.customerName ?? "-" },
    { label: "Tagihan", value: formatRupiah(inquiryResult.amount) },
    { label: "Admin", value: formatRupiah(inquiryResult.adminFee) },
    { label: "Total", value: formatRupiah(inquiryResult.total), bold: true },
  ] : null

  const inputSection = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nomor BPJS</Label>
        <Input
          placeholder="Masukkan nomor BPJS"
          value={customerId}
          onChange={(e) => { setCustomerId(e.target.value.replace(/\D/g, "")); setInquiryResult(null) }}
          className="font-mono !text-xl h-12 tracking-wider"
          autoFocus
        />
      </div>

      {!inquiryResult && (
        <Button className="w-full" onClick={handleInquiry} disabled={bpjsInquiry.isPending || customerId.length < 10}>
          {bpjsInquiry.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cek Tagihan...</> : "Cek Tagihan"}
        </Button>
      )}

      {!wideLayout && confirmItems && (
        <>
          <Separator />
          <ConfirmSection items={confirmItems} onConfirm={handleConfirm} />
        </>
      )}
    </div>
  )

  if (wideLayout) {
    return (
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8">{inputSection}</div>
        <div className="col-span-4">
          <div className="sticky top-6">
            {confirmItems ? (
              <ConfirmSection items={confirmItems} onConfirm={handleConfirm} />
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                <HeartPulse className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm">Cek tagihan untuk melihat detail</p>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return inputSection
}

// --- E-Money Input ---
function EmoneyInput({
  onAddToCart,
  wideLayout = false,
}: {
  onAddToCart: (item: {
    name: string
    price: number
    service_type: string
    service_ref: string
    buy_price?: number
    ppob_inquiry_id?: string
    ppob_product_code?: string
  }) => void
  wideLayout?: boolean
}) {
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
      }
    )
  }

  const handleConfirm = () => {
    if (!inquiryResult || !selectedDenom) return
    onAddToCart({
      name: `E-Money ${selectedDenom.denom} - ${phoneNumber}`,
      price: inquiryResult.total,
      service_type: "emoney",
      service_ref: phoneNumber,
      buy_price: inquiryResult.amount,
      ppob_inquiry_id: inquiryResult.inquiryId,
      ppob_product_code: selectedDenom.denom,
    })
  }

  const confirmItems = inquiryResult ? [
    { label: "Layanan", value: "E-Money" },
    { label: "Nomor", value: phoneNumber, mono: true },
    { label: "Nominal", value: selectedDenom?.denom ? formatRupiah(parseFloat(selectedDenom.denom)) : "-" },
    { label: "Total", value: formatRupiah(inquiryResult.total), bold: true },
  ] : null

  const inputSection = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nomor HP / ID</Label>
        <Input
          placeholder="Masukkan nomor"
          value={phoneNumber}
          onChange={(e) => { setPhoneNumber(e.target.value.replace(/\D/g, "")); setSelectedDenom(null); setInquiryResult(null) }}
          className="font-mono !text-xl h-12 tracking-wider"
          autoFocus
        />
      </div>

      {isLoading && (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      )}

      {denoms && denoms.length > 0 && (
        <div className="space-y-2">
          <Label>Nominal</Label>
          <div className="grid grid-cols-3 gap-2">
            {denoms.map((d) => (
              <Button key={d.id} variant={selectedDenom?.id === d.id ? "default" : "outline"} className="h-12 text-sm font-semibold"
                onClick={() => { setSelectedDenom(d); setInquiryResult(null) }}
              >
                {formatRupiah(parseFloat(d.denom))}
              </Button>
            ))}
          </div>
        </div>
      )}

      {phoneNumber && selectedDenom && !inquiryResult && (
        <Button className="w-full" onClick={handleInquiry} disabled={emoneyInquiry.isPending || phoneNumber.length < 8}>
          {emoneyInquiry.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memproses...</> : "Cek & Proses"}
        </Button>
      )}

      {!wideLayout && confirmItems && (
        <>
          <Separator />
          <ConfirmSection items={confirmItems} onConfirm={handleConfirm} />
        </>
      )}
    </div>
  )

  if (wideLayout) {
    return (
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8">{inputSection}</div>
        <div className="col-span-4">
          <div className="sticky top-6">
            {confirmItems ? (
              <ConfirmSection items={confirmItems} onConfirm={handleConfirm} />
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                <Wallet className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm">Cek nominal untuk melihat detail</p>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return inputSection
}

// --- Shared Confirm Section ---
function ConfirmSection({
  items,
  onConfirm,
}: {
  items: { label: string; value: string; mono?: boolean; bold?: boolean; green?: boolean }[]
  onConfirm: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [])

  return (
    <div ref={ref} className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-green-600">
        <CheckCircle2 className="h-4 w-4" />
        Siap ditambahkan ke keranjang
      </div>
      <div className="rounded-lg border p-3 space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex justify-between text-sm">
            <span className="text-muted-foreground">{item.label}</span>
            <span className={[
              item.mono && "font-mono",
              item.bold && "font-bold text-base",
              item.green && "text-green-600 font-medium",
            ].filter(Boolean).join(" ")}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
      <Button className="w-full" size="lg" onClick={onConfirm}>
        <Smartphone className="mr-2 h-4 w-4" />
        Tambah ke Keranjang
      </Button>
    </div>
  )
}

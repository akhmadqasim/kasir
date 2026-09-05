import { useState, useEffect, useRef } from "react"
import {
  Smartphone,
  Zap,
  Droplets,
  HeartPulse,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  RefreshCw,
  History,
  Wallet,
} from "lucide-react"
import { toast } from "@/lib/toast"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { QUICK_ACCESS_SERVICES, PPOB_SERVICE_COLORS, type QuickAccessServiceKey } from "@/features/ppob/constants"
import type { PulsaDetailProduct, InquiryResult } from "@/features/ppob/types"
import type { PpobMarkup, PpobMarkupConfig } from "@/features/ppob/types/auth"
import type { AppSettings } from "@/features/settings/types"
import { useCartStore } from "../hooks/use-cart-store"
import { DEFAULT_PPOB_MARKUP, resolvePpobSellPrice } from "../ppob-pricing"
import { formatRupiah } from "../utils"

export type ServiceType = QuickAccessServiceKey

/**
 * Resolves the price the customer is charged. The confirmation panel and the
 * cart both read this same value, so what is shown is what is charged.
 */
export type ResolveSellPrice = (input: {
  name: string
  serviceType: string
  vendorCost: number
}) => number

interface BpjsParticipant {
  number: string
  name: string
}

function getBpjsDataBook(rawData: Record<string, unknown> | undefined): string {
  const inquiry = rawData?.inquiry
  if (inquiry && typeof inquiry === "object" && typeof (inquiry as { data_book?: unknown }).data_book === "string") {
    return (inquiry as { data_book: string }).data_book
  }

  const data = rawData?.data
  if (data && typeof data === "object" && typeof (data as { data_book?: unknown }).data_book === "string") {
    return (data as { data_book: string }).data_book
  }

  return ""
}

function parseBpjsParticipants(dataBook: string): BpjsParticipant[] {
  const participants: BpjsParticipant[] = []
  let current: Partial<BpjsParticipant> = {}

  const pushCurrent = () => {
    if (current.number || current.name) {
      participants.push({
        number: current.number ?? "",
        name: current.name ?? "",
      })
      current = {}
    }
  }

  for (const line of dataBook.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith("----- Peserta")) {
      pushCurrent()
      continue
    }

    const [label, rawValue] = trimmed.split(/\s*:\s*/, 2)
    const value = rawValue?.trim() ?? ""
    if (!value) continue

    if (label === "Nomor Peserta") {
      current.number = value
    } else if (label === "Nama Peserta") {
      current.name = value
    }
  }

  pushCurrent()
  return participants
}

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
  const addPpobItem = useCartStore((s) => s.addPpobItem)

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
    if (!markup) return DEFAULT_PPOB_MARKUP
    return (markup as unknown as Record<string, PpobMarkupConfig>)[serviceType] ?? DEFAULT_PPOB_MARKUP
  }

  const resolveSellPrice: ResolveSellPrice = ({ name, serviceType, vendorCost }) =>
    resolvePpobSellPrice({
      name,
      serviceType,
      vendorCost,
      markup: getMarkupConfig(serviceType),
      customPrices,
    })

  const handleAddToCart = (item: {
    name: string
    /** Final sell price, already resolved by the caller via resolveSellPrice */
    price: number
    service_type: string
    service_ref: string
    /** What the store pays the vendor — bill plus admin fee for bill payments */
    buy_price?: number
    ppob_product_id?: number
    ppob_product_code?: string
    ppob_inquiry_id?: string
    ppob_payment_code?: string
    ppob_flag_id?: string
  }) => {
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
              const svc = QUICK_ACCESS_SERVICES.find(s => s.key === selectedService)
              if (!svc) return null
              const Icon = svc.icon
              return <Icon className={`h-4 w-4 ${PPOB_SERVICE_COLORS[svc.key].text}`} />
            })()}
            <span className="text-sm font-medium">
              {QUICK_ACCESS_SERVICES.find(s => s.key === selectedService)?.label}
            </span>
          </div>
        </div>

        {selectedService === "pulsa" && <PulsaInput onAddToCart={handleAddToCart} resolveSellPrice={resolveSellPrice} productType="pulsa" wideLayout={wideLayout} />}
        {selectedService === "data" && <PulsaInput onAddToCart={handleAddToCart} resolveSellPrice={resolveSellPrice} productType="data" wideLayout={wideLayout} />}
        {selectedService === "pln" && <PlnInput onAddToCart={handleAddToCart} resolveSellPrice={resolveSellPrice} wideLayout={wideLayout} />}
        {selectedService === "pdam" && <PdamInput onAddToCart={handleAddToCart} resolveSellPrice={resolveSellPrice} wideLayout={wideLayout} />}
        {selectedService === "bpjs" && <BpjsInput onAddToCart={handleAddToCart} resolveSellPrice={resolveSellPrice} wideLayout={wideLayout} />}
        {selectedService === "emoney" && <EmoneyInput onAddToCart={handleAddToCart} resolveSellPrice={resolveSellPrice} wideLayout={wideLayout} />}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      {showSaldoBar && <SaldoBar />}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {QUICK_ACCESS_SERVICES.map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            variant="outline"
            className="h-auto flex-col gap-1.5 py-3"
            onClick={() => setSelectedService(key)}
          >
            <Icon className={`h-5 w-5 ${PPOB_SERVICE_COLORS[key].text}`} />
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
  resolveSellPrice,
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
  resolveSellPrice: ResolveSellPrice
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

  const confirmItems = selected ? [
    { label: "Layanan", value: productType === "pulsa" ? "Pulsa" : "Paket Data" },
    { label: "Provider", value: data?.provider ?? "-" },
    { label: "Nomor HP", value: phoneNumber, mono: true },
    { label: "Produk", value: selected.description.replace(/\n/g, " ") },
    { label: "Modal", value: formatRupiah(selected.vendorPrice) },
    { label: "Harga Jual", value: formatRupiah(selectedSellPrice), bold: true },
    { label: "Margin", value: `+${formatRupiah(selectedSellPrice - selected.vendorPrice)}`, green: true },
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
            const sellPrice = getSellPrice(product)
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
  resolveSellPrice,
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
    ppob_flag_id?: string
  }) => void
  resolveSellPrice: ResolveSellPrice
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

  // Yang dibayar toko ke vendor = tagihan + biaya admin.
  const vendorCost = inquiryResult?.total ?? 0
  const itemName = (() => {
    const label = mode === "token" ? "PLN Token" : "PLN Bayar"
    const customerName = inquiryResult?.customerName ?? customerId
    const denomLabel = mode === "token" && selectedDenom !== null
      ? ` ${formatRupiah(parseFloat(denoms?.find(d => d.id === selectedDenom)?.denom ?? "0"))}`
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
    ...(sellPrice > vendorCost
      ? [{ label: "Markup", value: `+${formatRupiah(sellPrice - vendorCost)}`, green: true }]
      : []),
    { label: "Total Bayar", value: formatRupiah(sellPrice), bold: true },
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
  resolveSellPrice,
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
  resolveSellPrice: ResolveSellPrice
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

  // Yang dibayar toko ke vendor = tagihan + biaya admin.
  const vendorCost = inquiryResult?.total ?? 0
  const pdamName = pdamProducts?.find(p => p.plu === selectedPdam)?.merchant ?? "PDAM"
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
    ...(sellPrice > vendorCost
      ? [{ label: "Markup", value: `+${formatRupiah(sellPrice - vendorCost)}`, green: true }]
      : []),
    { label: "Total Bayar", value: formatRupiah(sellPrice), bold: true },
  ] : null

  const inputSection = (
    <div className="space-y-4">
      {pdamLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <div className="space-y-2">
          <Label>Pilih PDAM</Label>
          <Select
            value={selectedPdam}
            onValueChange={(value) => { setSelectedPdam(value); setInquiryResult(null) }}
          >
            <SelectTrigger>
              <SelectValue placeholder="-- Pilih PDAM --" />
            </SelectTrigger>
            <SelectContent>
              {pdamProducts?.map((p) => (
                <SelectItem key={p.id} value={p.plu}>{p.merchant}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
const BPJS_TYPE_OPTIONS = [
  { value: "BPJSKES", label: "Kesehatan", serviceLabel: "BPJS Kesehatan" },
  { value: "BPJSTK", label: "Ketenagakerjaan", serviceLabel: "BPJS Ketenagakerjaan" },
] as const

function BpjsInput({
  onAddToCart,
  resolveSellPrice,
  wideLayout = false,
}: {
  onAddToCart: (item: {
    name: string
    price: number
    service_type: string
    service_ref: string
    buy_price?: number
    ppob_product_code?: string
    ppob_inquiry_id?: string
    ppob_payment_code?: string
    ppob_flag_id?: string
  }) => void
  resolveSellPrice: ResolveSellPrice
  wideLayout?: boolean
}) {
  const [customerId, setCustomerId] = useState("")
  const [bpjsType, setBpjsType] = useState<(typeof BPJS_TYPE_OPTIONS)[number]["value"]>("BPJSKES")
  const bpjsInquiry = useBpjsInquiry()
  const [inquiryResult, setInquiryResult] = useState<InquiryResult | null>(null)
  const bpjsRawData = inquiryResult?.rawData as Record<string, unknown> | undefined
  const bpjsDataBook = getBpjsDataBook(bpjsRawData)
  const bpjsParticipants = parseBpjsParticipants(bpjsDataBook)
  const primaryParticipant =
    bpjsParticipants.find((participant) => participant.number === customerId) ?? bpjsParticipants[0]
  const displayCustomerName = primaryParticipant?.name ?? inquiryResult?.customerName ?? customerId
  const selectedBpjsType = BPJS_TYPE_OPTIONS.find((option) => option.value === bpjsType) ?? BPJS_TYPE_OPTIONS[0]
  const customerIdLabel = selectedBpjsType.value === "BPJSKES" ? "Nomor VA" : "Nomor Kartu"
  const customerIdPlaceholder = selectedBpjsType.value === "BPJSKES"
    ? "Masukkan nomor VA BPJS"
    : "Masukkan nomor kartu BPJS"
  const bpjsPaymentCode = (() => {
    const raw = inquiryResult?.rawData as { data?: Record<string, unknown>; payment_code?: unknown } | undefined
    const fromData = raw?.data?.payment_code
    if (typeof fromData === "string" && fromData.length > 0) return fromData
    if (typeof raw?.payment_code === "string" && raw.payment_code.length > 0) return raw.payment_code
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
      }
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

  const confirmItems = inquiryResult ? [
    { label: "Layanan", value: selectedBpjsType.serviceLabel },
    { label: customerIdLabel, value: customerId, mono: true },
    { label: "Nama Utama", value: displayCustomerName },
    ...(bpjsParticipants.length > 1 ? [{ label: "Jumlah Peserta", value: String(bpjsParticipants.length) }] : []),
    ...bpjsParticipants.map((participant, index) => ({
      label: `Peserta ${index + 1}`,
      value: participant.name || participant.number || "-",
    })),
    { label: "Tagihan", value: formatRupiah(inquiryResult.amount) },
    { label: "Admin", value: formatRupiah(inquiryResult.adminFee) },
    ...(sellPrice > vendorCost
      ? [{ label: "Markup", value: `+${formatRupiah(sellPrice - vendorCost)}`, green: true }]
      : []),
    { label: "Total Bayar", value: formatRupiah(sellPrice), bold: true },
  ] : null

  const inputSection = (
    <div className="space-y-4">
      <Tabs
        value={bpjsType}
        onValueChange={(value) => {
          setBpjsType(value as (typeof BPJS_TYPE_OPTIONS)[number]["value"])
          setInquiryResult(null)
        }}
      >
        <TabsList className="grid w-full grid-cols-2">
          {BPJS_TYPE_OPTIONS.map((option) => (
            <TabsTrigger key={option.value} value={option.value}>
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="space-y-2">
        <Label>{customerIdLabel}</Label>
        <Input
          placeholder={customerIdPlaceholder}
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
  resolveSellPrice,
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
  resolveSellPrice: ResolveSellPrice
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

  const confirmItems = inquiryResult ? [
    { label: "Layanan", value: "E-Money" },
    { label: "Nomor", value: phoneNumber, mono: true },
    { label: "Nominal", value: selectedDenom?.denom ? formatRupiah(parseFloat(selectedDenom.denom)) : "-" },
    ...(inquiryResult.adminFee > 0
      ? [{ label: "Admin", value: formatRupiah(inquiryResult.adminFee) }]
      : []),
    ...(sellPrice > vendorCost
      ? [{ label: "Markup", value: `+${formatRupiah(sellPrice - vendorCost)}`, green: true }]
      : []),
    { label: "Total Bayar", value: formatRupiah(sellPrice), bold: true },
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

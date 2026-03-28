import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { id } from "@/i18n/id"
import { useDebounce } from "@/hooks/use-debounce"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { usePulsaDetails, usePulsaPurchase } from "../hooks"
import type { PulsaDetailProduct, PaymentResult } from "../types"

function formatRupiah(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`
}

export function PulsaFlow() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === "admin"
  const [phoneNumber, setPhoneNumber] = useState("")
  const [selectedProduct, setSelectedProduct] = useState<PulsaDetailProduct | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [showResultDialog, setShowResultDialog] = useState(false)

  const debouncedPhone = useDebounce(phoneNumber, 300)
  const { data, isLoading, error } = usePulsaDetails(debouncedPhone)
  const pulsaPurchase = usePulsaPurchase()

  const handlePurchase = async () => {
    if (!selectedProduct || !phoneNumber) return

    setIsProcessing(true)
    setPaymentError(null)

    try {
      const result = await pulsaPurchase.mutateAsync({
        phoneNumber,
        productCode: selectedProduct.plu,
        productId: selectedProduct.id,
        productType: "pulsa",
      })
      setPaymentResult(result)
      setShowResultDialog(true)
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReset = () => {
    setShowResultDialog(false)
    setPaymentResult(null)
    setSelectedProduct(null)
    setPhoneNumber("")
    setPaymentError(null)
  }

  const handleCloseDialog = () => {
    setShowResultDialog(false)
    setPaymentResult(null)
    setSelectedProduct(null)
    setPaymentError(null)
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/ppob")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{id.ppob.pulsa}</h1>
        </div>
      </div>

      {/* Phone Number Input */}
      <Card>
        <CardContent>
          <div className="space-y-2">
            <Label className="text-base">{id.ppob.phoneNumber}</Label>
            <div className="flex items-center justify-between gap-3">
              <Input
                type="tel"
                placeholder={id.ppob.phoneNumberPlaceholder}
                value={phoneNumber}
                onChange={(e) => {
                  setPhoneNumber(e.target.value.replace(/\D/g, ""))
                  setSelectedProduct(null)
                  setPaymentError(null)
                }}
                className="max-w-sm font-mono text-xl md:text-xl h-12"
                disabled={isProcessing}
              />
              {/* Provider Detection - inline with input */}
              {data && (
                <div className="flex items-center gap-2 shrink-0">
                  {data.image && (
                    <img src={data.image} alt={data.provider} className="h-10" />
                  )}
                  <Badge variant="secondary" className="text-sm">{data.provider}</Badge>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Two-column layout */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8 space-y-6">
          {/* Loading */}
          {isLoading && phoneNumber.length >= 10 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          )}

          {/* Error */}
          {error && phoneNumber.length >= 10 && (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-destructive">{error.message}</p>
              </CardContent>
            </Card>
          )}

          {/* Product Grid */}
          {data && data.products.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {data.products
                .filter((p) => p.isTrouble === 0)
                .map((product) => {
                  const isSelected = selectedProduct?.id === product.id
                  const sellPrice = product.lastPrice ?? product.basePrice
                  const margin = sellPrice - product.vendorPrice

                  return (
                    <Card
                      key={product.id}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "hover:bg-accent"
                      } ${isProcessing ? "pointer-events-none opacity-50" : ""}`}
                      onClick={() => {
                        if (!isProcessing) {
                          setSelectedProduct(product)
                          setPaymentError(null)
                        }
                      }}
                    >
                      <CardContent className="py-4">
                        <p className="font-bold text-xl leading-tight">
                          {product.description.replace(/\n/g, " ")}
                        </p>
                        <div className="mt-2 space-y-1">
                          <p className="text-lg font-bold">
                            {formatRupiah(sellPrice)}
                          </p>
                          {isAdmin && (
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>{id.ppob.basePrice}: {formatRupiah(product.vendorPrice)}</span>
                              <Badge variant="outline" className="text-xs">
                                +{formatRupiah(margin)}
                              </Badge>
                            </div>
                          )}
                        </div>
                        {product.nominalCutPrice != null && product.nominalCutPrice > 0 && (
                          <Badge variant="destructive" className="mt-2 text-xs">
                            Promo -{formatRupiah(product.nominalCutPrice)}
                          </Badge>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
            </div>
          )}
        </div>

        {/* Confirmation Panel */}
        <div className="col-span-4">
          <div className="sticky top-6">
            {selectedProduct ? (
              <Card className="border-primary">
                <CardHeader>
                  <CardTitle className="text-lg">{id.ppob.confirm}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.provider}</span>
                    <span className="font-medium">{data?.provider}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.phoneNumber}</span>
                    <span className="font-mono text-base font-medium">{phoneNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.nominal}</span>
                    <span className="font-medium">
                      {selectedProduct.description.replace(/\n/g, " ")}
                    </span>
                  </div>

                  <Separator />

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.totalPayment}</span>
                    <span className="text-lg font-bold">
                      {formatRupiah(selectedProduct.lastPrice ?? selectedProduct.basePrice)}
                    </span>
                  </div>
                  {isAdmin && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{id.ppob.margin}</span>
                      <span className="text-green-600 font-medium">
                        +{formatRupiah(
                          (selectedProduct.lastPrice ?? selectedProduct.basePrice) -
                            selectedProduct.vendorPrice
                        )}
                      </span>
                    </div>
                  )}

                  {/* Error message */}
                  {paymentError && (
                    <div className="rounded-lg bg-destructive/10 p-3 text-sm">
                      <p className="text-destructive flex items-center gap-2">
                        <XCircle className="h-4 w-4 shrink-0" />
                        {paymentError}
                      </p>
                    </div>
                  )}

                  {/* Purchase button */}
                  <Button
                    className="w-full mt-4"
                    size="lg"
                    onClick={handlePurchase}
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {id.ppob.paymentLoading}
                      </>
                    ) : (
                      id.ppob.process
                    )}
                  </Button>
                </CardContent>
              </Card>
            ) : data ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                Pilih produk untuk melihat konfirmasi
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Success Dialog */}
      <Dialog open={showResultDialog} onOpenChange={setShowResultDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {paymentResult?.success ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  {id.ppob.paymentSuccess}
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-destructive" />
                  {id.ppob.paymentFailed}
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          {paymentResult && (
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{id.ppob.provider}</span>
                <span className="font-medium">{data?.provider}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{id.ppob.phoneNumber}</span>
                <span className="font-mono">{paymentResult.customerId}</span>
              </div>
              {selectedProduct && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{id.ppob.product}</span>
                  <span className="font-medium text-right max-w-[60%]">
                    {selectedProduct.description.replace(/\n/g, " ")}
                  </span>
                </div>
              )}

              <Separator />

              <div className="flex justify-between font-bold">
                <span>{id.ppob.totalPayment}</span>
                <span className="text-lg">{formatRupiah(paymentResult.total)}</span>
              </div>

              {paymentResult.serialNumber && (
                <>
                  <Separator />
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-xs text-muted-foreground mb-1">
                      {id.ppob.referenceNumber}
                    </p>
                    <p className="font-mono font-bold text-lg tracking-wider break-all">
                      {paymentResult.serialNumber}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter className="flex gap-3 sm:gap-3">
            <Button variant="outline" onClick={handleCloseDialog}>
              {id.ppob.closeAndReset}
            </Button>
            <Button onClick={handleReset}>
              {id.ppob.purchaseAnother}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

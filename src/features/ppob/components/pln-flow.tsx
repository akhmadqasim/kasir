import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Zap, CheckCircle2, XCircle, Loader2, Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { id } from "@/i18n/id"
import { usePlnDenom } from "../hooks"
import { usePlnInquiry } from "../hooks/use-inquiry"
import { usePpobPayment } from "../hooks/use-payment"
import type { PlnDenom, InquiryResult, PaymentResult } from "../types"

function formatRupiah(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`
}

export function PlnFlow() {
  const navigate = useNavigate()
  const [plnType, setPlnType] = useState<"token" | "tagihan">("token")
  const [customerId, setCustomerId] = useState("")
  const [selectedDenom, setSelectedDenom] = useState<PlnDenom | null>(null)

  // Inquiry & payment state
  const [inquiryResult, setInquiryResult] = useState<InquiryResult | null>(null)
  const [isInquiring, setIsInquiring] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [inquiryError, setInquiryError] = useState<string | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null)
  const [showResultDialog, setShowResultDialog] = useState(false)

  const { data: denoms, isLoading } = usePlnDenom()
  const plnInquiry = usePlnInquiry()
  const ppobPayment = usePpobPayment()

  const handleInquiry = async () => {
    if (!selectedDenom || customerId.length < 8) return

    setIsInquiring(true)
    setInquiryError(null)
    setInquiryResult(null)

    try {
      const result = await plnInquiry.mutateAsync({
        customerId,
        paymentCode: selectedDenom.denom,
        flagId: "0",
        amount: 0,
      })
      setInquiryResult(result)
    } catch (err) {
      setInquiryError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsInquiring(false)
    }
  }

  const handlePayment = async () => {
    if (!inquiryResult) return

    setIsProcessing(true)
    setPaymentError(null)

    try {
      const result = await ppobPayment.mutateAsync({
        serviceType: "pln",
        inquiryId: inquiryResult.inquiryId,
        customerId,
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
    setInquiryResult(null)
    setSelectedDenom(null)
    setCustomerId("")
    setInquiryError(null)
    setPaymentError(null)
  }

  const handleCloseDialog = () => {
    setShowResultDialog(false)
    setPaymentResult(null)
    setInquiryResult(null)
    setInquiryError(null)
    setPaymentError(null)
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/ppob")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{id.ppob.pln}</h1>
        </div>
      </div>

      {/* PLN Type Tabs */}
      <Tabs value={plnType} onValueChange={(v) => {
        setPlnType(v as "token" | "tagihan")
        setSelectedDenom(null)
        setInquiryResult(null)
        setInquiryError(null)
        setPaymentError(null)
      }}>
        <TabsList className="grid w-full max-w-sm grid-cols-2">
          <TabsTrigger value="token">
            <Zap className="h-4 w-4 mr-2" />
            Token Listrik
          </TabsTrigger>
          <TabsTrigger value="tagihan">
            <Receipt className="h-4 w-4 mr-2" />
            Tagihan Listrik
          </TabsTrigger>
        </TabsList>

        {/* Token (Prepaid) */}
        <TabsContent value="token" className="space-y-6 mt-6">
          {/* Customer ID */}
          <Card>
            <CardContent>
              <div className="space-y-2">
                <Label className="text-base">No. Meter / ID Pelanggan</Label>
                <Input
                  type="text"
                  placeholder="Masukkan nomor meter PLN..."
                  value={customerId}
                  onChange={(e) => {
                    setCustomerId(e.target.value.replace(/\D/g, ""))
                    setInquiryResult(null)
                    setInquiryError(null)
                    setPaymentError(null)
                  }}
                  className="max-w-sm font-mono text-xl md:text-xl h-12"
                  disabled={isInquiring || isProcessing}
                />
              </div>
            </CardContent>
          </Card>

          {/* Two-column layout */}
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-8 space-y-6">
              {/* Denomination Grid */}
              {isLoading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-20" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {denoms?.map((denom) => {
                    const value = parseFloat(denom.denom)
                    const isSelected = selectedDenom?.id === denom.id
                    return (
                      <Card
                        key={denom.id}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "hover:bg-accent"
                        } ${isInquiring || isProcessing ? "pointer-events-none opacity-50" : ""}`}
                        onClick={() => {
                          if (!isInquiring && !isProcessing) {
                            setSelectedDenom(denom)
                            setInquiryResult(null)
                            setInquiryError(null)
                            setPaymentError(null)
                          }
                        }}
                      >
                        <CardContent className="flex items-center justify-center py-6">
                          <div className="text-center">
                            <Zap className="h-5 w-5 mx-auto mb-1 text-yellow-500" />
                            <p className="font-bold text-xl">{formatRupiah(value)}</p>
                          </div>
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
                {selectedDenom && customerId.length >= 8 ? (
                  <Card className="border-primary">
                    <CardHeader>
                      <CardTitle className="text-lg">{id.ppob.confirm}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{id.ppob.customerId}</span>
                        <span className="font-mono text-base font-medium">{customerId}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{id.ppob.nominal}</span>
                        <span className="text-lg font-bold">
                          {formatRupiah(parseFloat(selectedDenom.denom))}
                        </span>
                      </div>

                      {/* Inquiry result */}
                      {inquiryResult && (
                        <>
                          <Separator />
                          {inquiryResult.customerName && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Nama</span>
                              <span className="font-medium text-right max-w-[60%]">
                                {inquiryResult.customerName}
                              </span>
                            </div>
                          )}
                          {inquiryResult.adminFee > 0 && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{id.ppob.fee}</span>
                              <span>{formatRupiah(inquiryResult.adminFee)}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-bold">
                            <span>{id.ppob.totalPayment}</span>
                            <span className="text-lg">
                              {formatRupiah(inquiryResult.total || parseFloat(selectedDenom.denom))}
                            </span>
                          </div>
                        </>
                      )}

                      {/* Inquiry error */}
                      {inquiryError && (
                        <div className="rounded-lg bg-destructive/10 p-3 text-sm">
                          <p className="text-destructive flex items-center gap-2">
                            <XCircle className="h-4 w-4 shrink-0" />
                            {inquiryError}
                          </p>
                        </div>
                      )}

                      {/* Payment error */}
                      {paymentError && (
                        <div className="rounded-lg bg-destructive/10 p-3 text-sm">
                          <p className="text-destructive flex items-center gap-2">
                            <XCircle className="h-4 w-4 shrink-0" />
                            {paymentError}
                          </p>
                        </div>
                      )}

                      {/* Action buttons */}
                      {!inquiryResult ? (
                        <Button
                          className="w-full mt-4"
                          size="lg"
                          onClick={handleInquiry}
                          disabled={isInquiring}
                        >
                          {isInquiring ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              {id.ppob.inquiryLoading}
                            </>
                          ) : (
                            "Cek & Proses"
                          )}
                        </Button>
                      ) : (
                        <div className="flex gap-2 mt-4">
                          <Button
                            variant="outline"
                            className="flex-1"
                            onClick={() => {
                              setInquiryResult(null)
                              setPaymentError(null)
                            }}
                            disabled={isProcessing}
                          >
                            {id.ppob.cancelInquiry}
                          </Button>
                          <Button
                            className="flex-1"
                            size="lg"
                            onClick={handlePayment}
                            disabled={isProcessing}
                          >
                            {isProcessing ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                {id.ppob.paymentLoading}
                              </>
                            ) : (
                              id.ppob.confirmPayment
                            )}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ) : denoms ? (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    Pilih nominal dan masukkan nomor meter
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Tagihan (Postpaid) — Coming Soon */}
        <TabsContent value="tagihan" className="mt-6">
          <Card>
            <CardContent className="py-16 text-center">
              <Receipt className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">Tagihan Listrik</h3>
              <p className="text-muted-foreground">
                Fitur pembayaran tagihan listrik pascabayar akan segera tersedia.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
                <span className="text-muted-foreground">{id.ppob.customerId}</span>
                <span className="font-mono">{paymentResult.customerId}</span>
              </div>
              {paymentResult.customerName && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nama Pelanggan</span>
                  <span className="font-medium text-right max-w-[60%]">
                    {paymentResult.customerName}
                  </span>
                </div>
              )}
              {selectedDenom && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{id.ppob.nominal}</span>
                  <span className="font-medium">
                    {formatRupiah(parseFloat(selectedDenom.denom))}
                  </span>
                </div>
              )}

              <Separator />

              {paymentResult.adminFee > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{id.ppob.fee}</span>
                  <span>{formatRupiah(paymentResult.adminFee)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold">
                <span>{id.ppob.totalPayment}</span>
                <span className="text-lg">
                  {formatRupiah(paymentResult.total || parseFloat(selectedDenom?.denom ?? "0"))}
                </span>
              </div>

              {paymentResult.serialNumber && (
                <>
                  <Separator />
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-xs text-muted-foreground mb-1">Token PLN</p>
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

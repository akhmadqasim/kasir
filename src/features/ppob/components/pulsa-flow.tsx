import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { id } from "@/i18n/id"
import { usePulsaDetails } from "../hooks/use-ppob"
import type { PulsaDetailProduct } from "../types"

function formatRupiah(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`
}

export function PulsaFlow() {
  const navigate = useNavigate()
  const [phoneNumber, setPhoneNumber] = useState("")
  const [selectedProduct, setSelectedProduct] = useState<PulsaDetailProduct | null>(null)

  const { data, isLoading, error } = usePulsaDetails(phoneNumber)

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate("/ppob")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{id.ppob.pulsa}</h1>
          <p className="text-sm text-muted-foreground">
            {id.ppob.selectNominal}
          </p>
        </div>
      </div>

      {/* Phone Number Input */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="space-y-2">
            <Label>{id.ppob.phoneNumber}</Label>
            <div className="flex gap-2">
              <Input
                type="tel"
                placeholder={id.ppob.phoneNumberPlaceholder}
                value={phoneNumber}
                onChange={(e) => {
                  setPhoneNumber(e.target.value.replace(/\D/g, ""))
                  setSelectedProduct(null)
                }}
                className="font-mono"
              />
            </div>
          </div>

          {/* Provider Detection */}
          {data && (
            <div className="flex items-center gap-3 mt-4">
              {data.image && (
                <img src={data.image} alt={data.provider} className="h-8" />
              )}
              <Badge variant="secondary">{data.provider}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading */}
      {isLoading && phoneNumber.length >= 10 && (
        <div className="grid grid-cols-2 gap-3">
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
        <div className="grid grid-cols-2 gap-3">
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
                  }`}
                  onClick={() => setSelectedProduct(product)}
                >
                  <CardContent className="py-4">
                    <p className="font-medium text-sm leading-tight">
                      {product.description.replace(/\n/g, " ")}
                    </p>
                    <div className="mt-2 space-y-1">
                      <p className="text-lg font-bold">
                        {formatRupiah(sellPrice)}
                      </p>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{id.ppob.basePrice}: {formatRupiah(product.vendorPrice)}</span>
                        <Badge variant="outline" className="text-xs">
                          +{formatRupiah(margin)}
                        </Badge>
                      </div>
                    </div>
                    {product.nominalCutPrice && product.nominalCutPrice > 0 && (
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

      {/* Confirmation */}
      {selectedProduct && (
        <Card className="mt-6 border-primary">
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
              <span className="font-mono">{phoneNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{id.ppob.nominal}</span>
              <span className="font-medium">
                {selectedProduct.description.replace(/\n/g, " ")}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{id.ppob.price}</span>
              <span className="text-lg font-bold">
                {formatRupiah(selectedProduct.lastPrice ?? selectedProduct.basePrice)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{id.ppob.margin}</span>
              <span className="text-green-600 font-medium">
                +{formatRupiah(
                  (selectedProduct.lastPrice ?? selectedProduct.basePrice) -
                    selectedProduct.vendorPrice
                )}
              </span>
            </div>
            <Button className="w-full mt-4" size="lg" disabled>
              {id.ppob.process} (Coming Soon)
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

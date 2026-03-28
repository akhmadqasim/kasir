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
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { usePulsaProviders, useDataPriceList } from "../hooks"
import type { PulsaProvider, PulsaProduct } from "../types"

function formatRupiah(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`
}

export function DataFlow() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === "admin"
  const [phoneNumber, setPhoneNumber] = useState("")
  const [selectedProvider, setSelectedProvider] = useState<PulsaProvider | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<PulsaProduct | null>(null)

  const { data: providers, isLoading: providersLoading } = usePulsaProviders()
  const { data: products, isLoading: productsLoading } = useDataPriceList(
    selectedProvider?.uid ?? ""
  )

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/ppob")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{id.ppob.dataPacket}</h1>
        </div>
      </div>

      {/* Phone Number Input */}
      <Card>
        <CardContent>
          <div className="space-y-2">
            <Label className="text-base">{id.ppob.phoneNumber}</Label>
            <Input
              type="tel"
              placeholder={id.ppob.phoneNumberPlaceholder}
              value={phoneNumber}
              onChange={(e) => {
                setPhoneNumber(e.target.value.replace(/\D/g, ""))
                setSelectedProvider(null)
                setSelectedProduct(null)
              }}
              className="max-w-sm font-mono text-xl md:text-xl h-12"
            />
          </div>
        </CardContent>
      </Card>

      {/* Two-column layout */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8 space-y-6">
          {/* Provider Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{id.ppob.selectProvider}</CardTitle>
            </CardHeader>
            <CardContent>
              {providersLoading ? (
                <div className="flex gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-24" />
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {providers?.map((prov) => {
                    const isSelected = selectedProvider?.uid === prov.uid
                    return (
                      <Card
                        key={prov.uid}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "hover:bg-accent"
                        }`}
                        onClick={() => {
                          setSelectedProvider(prov)
                          setSelectedProduct(null)
                        }}
                      >
                        <CardContent className="flex items-center gap-2 py-3 px-4">
                          {prov.image && (
                            <img src={prov.image} alt={prov.provider} className="h-6" />
                          )}
                          <span className="text-sm font-medium">{prov.provider}</span>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Data Package Grid */}
          {selectedProvider && productsLoading && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          )}

          {selectedProvider && products && products.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {products.map((product) => {
                const isSelected = selectedProduct?.pulsaProductId === product.pulsaProductId
                const price = product.memberPrice || product.productPrice

                return (
                  <Card
                    key={product.pulsaProductId}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "hover:bg-accent"
                    }`}
                    onClick={() => setSelectedProduct(product)}
                  >
                    <CardContent className="py-4">
                      <p className="font-bold text-xl leading-tight">
                        {product.description}
                      </p>
                      <div className="mt-2 space-y-1">
                        <p className="text-lg font-bold">{formatRupiah(price)}</p>
                        {isAdmin && (
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>
                              {id.ppob.basePrice}: {formatRupiah(Number(product.basePrice))}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              +{formatRupiah(price - Number(product.basePrice))}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        <div className="col-span-4">
          <div className="sticky top-6">
            {selectedProduct && phoneNumber.length >= 10 ? (
              <Card className="border-primary">
                <CardHeader>
                  <CardTitle className="text-lg">{id.ppob.confirm}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.provider}</span>
                    <span className="font-medium">{selectedProvider?.provider}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.phoneNumber}</span>
                    <span className="font-mono text-base font-medium">{phoneNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.nominal}</span>
                    <span className="font-medium">{selectedProduct.description}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.price}</span>
                    <span className="text-lg font-bold">
                      {formatRupiah(selectedProduct.memberPrice || selectedProduct.productPrice)}
                    </span>
                  </div>
                  {isAdmin && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{id.ppob.margin}</span>
                      <span className="text-green-600 font-medium">
                        +{formatRupiah(
                          (selectedProduct.memberPrice || selectedProduct.productPrice) -
                            Number(selectedProduct.basePrice)
                        )}
                      </span>
                    </div>
                  )}
                  <Button className="w-full mt-4" size="lg" disabled>
                    {id.ppob.process} (Coming Soon)
                  </Button>
                </CardContent>
              </Card>
            ) : products ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                Pilih produk untuk melihat konfirmasi
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

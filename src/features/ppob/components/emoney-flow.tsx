import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { id } from "@/i18n/id"
import { useEmoneyDenom } from "../hooks"
import type { EmoneyDenom } from "../types"

function formatRupiah(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`
}

export function EmoneyFlow() {
  const navigate = useNavigate()
  const [emoneyNumber, setEmoneyNumber] = useState("")
  const [selectedDenom, setSelectedDenom] = useState<EmoneyDenom | null>(null)

  const { data: denoms, isLoading } = useEmoneyDenom(1)

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/ppob")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{id.ppob.emoney}</h1>
        </div>
      </div>

      {/* E-Money Number Input */}
      <Card>
        <CardContent>
          <div className="space-y-2">
            <Label className="text-base">{id.ppob.emoneyNumber}</Label>
            <Input
              type="text"
              placeholder={id.ppob.emoneyNumberPlaceholder}
              value={emoneyNumber}
              onChange={(e) => setEmoneyNumber(e.target.value.replace(/\D/g, ""))}
              className="max-w-sm font-mono text-xl md:text-xl h-12"
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
                    }`}
                    onClick={() => setSelectedDenom(denom)}
                  >
                    <CardContent className="flex items-center justify-center py-6">
                      <div className="text-center">
                        <Wallet className="h-5 w-5 mx-auto mb-1 text-pink-500" />
                        <p className="font-bold text-xl">{formatRupiah(value)}</p>
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
            {selectedDenom && emoneyNumber.length >= 8 ? (
              <Card className="border-primary">
                <CardHeader>
                  <CardTitle className="text-lg">{id.ppob.confirm}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.emoneyNumber}</span>
                    <span className="font-mono text-base font-medium">{emoneyNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.nominal}</span>
                    <span className="text-lg font-bold">
                      {formatRupiah(parseFloat(selectedDenom.denom))}
                    </span>
                  </div>
                  <Button className="w-full mt-4" size="lg" disabled>
                    {id.ppob.process} (Coming Soon)
                  </Button>
                </CardContent>
              </Card>
            ) : denoms ? (
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

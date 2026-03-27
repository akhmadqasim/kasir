import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { id } from "@/i18n/id"
import { usePlnDenom } from "../hooks/use-ppob"
import type { PlnDenom } from "../types"

function formatRupiah(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`
}

export function PlnFlow() {
  const navigate = useNavigate()
  const [customerId, setCustomerId] = useState("")
  const [selectedDenom, setSelectedDenom] = useState<PlnDenom | null>(null)

  const { data: denoms, isLoading } = usePlnDenom()

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate("/ppob")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{id.ppob.pln}</h1>
          <p className="text-sm text-muted-foreground">
            {id.ppob.selectNominal}
          </p>
        </div>
      </div>

      {/* Customer ID */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="space-y-2">
            <Label>{id.ppob.customerId}</Label>
            <Input
              type="text"
              placeholder={id.ppob.customerIdPlaceholder}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value.replace(/\D/g, ""))}
              className="font-mono"
            />
          </div>
        </CardContent>
      </Card>

      {/* Denomination Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                    <Zap className="h-5 w-5 mx-auto mb-1 text-yellow-500" />
                    <p className="font-bold">{formatRupiah(value)}</p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Confirmation */}
      {selectedDenom && customerId.length >= 8 && (
        <Card className="mt-6 border-primary">
          <CardHeader>
            <CardTitle className="text-lg">{id.ppob.confirm}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{id.ppob.customerId}</span>
              <span className="font-mono">{customerId}</span>
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
      )}
    </div>
  )
}

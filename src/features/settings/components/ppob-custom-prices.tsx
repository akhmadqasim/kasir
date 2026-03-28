import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

interface PpobCustomPricesProps {
  customPrices: Record<string, number>
  onCustomPricesChange: (prices: Record<string, number>) => void
  disabled: boolean
}

const PRESET_NOMINALS = [5000, 10000, 15000, 20000, 25000, 50000, 100000, 150000, 200000]

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function PpobCustomPrices({
  customPrices,
  onCustomPricesChange,
  disabled,
}: PpobCustomPricesProps) {
  const [newNominal, setNewNominal] = useState("")

  const allNominals = Array.from(
    new Set([...PRESET_NOMINALS, ...Object.keys(customPrices).map(Number).filter((n) => !isNaN(n))])
  ).sort((a, b) => a - b)

  const handlePriceChange = (nominal: number, sellPrice: number | undefined) => {
    const updated = { ...customPrices }
    if (sellPrice === undefined || sellPrice <= 0) {
      delete updated[String(nominal)]
    } else {
      updated[String(nominal)] = sellPrice
    }
    onCustomPricesChange(updated)
  }

  const handleAddNominal = () => {
    const parsed = parseInt(newNominal.replace(/\./g, ""), 10)
    if (isNaN(parsed) || parsed <= 0) return
    if (!allNominals.includes(parsed)) {
      handlePriceChange(parsed, 0)
    }
    setNewNominal("")
  }

  const handleRemoveCustom = (nominal: number) => {
    if (PRESET_NOMINALS.includes(nominal)) {
      handlePriceChange(nominal, undefined)
    } else {
      const updated = { ...customPrices }
      delete updated[String(nominal)]
      onCustomPricesChange(updated)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <Label className="text-base">Harga Jual Pulsa per Nominal</Label>
        <p className="text-xs text-muted-foreground">
          Berlaku untuk semua provider. Nominal tanpa harga pakai markup umum.
        </p>
      </div>

      <div className="grid gap-2">
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 text-xs font-medium text-muted-foreground px-1">
          <span>Nominal</span>
          <span className="w-28 text-center">Harga Jual</span>
          <span className="w-8" />
        </div>
        {allNominals.map((nominal) => {
          const sellPrice = customPrices[String(nominal)]
          const hasPrice = sellPrice !== undefined && sellPrice > 0
          const isCustomNominal = !PRESET_NOMINALS.includes(nominal)

          return (
            <div key={nominal} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium tabular-nums">
                  Rp {formatRupiah(nominal)}
                </span>
                {isCustomNominal && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1">custom</Badge>
                )}
              </div>
              <Input
                type="number"
                min="0"
                placeholder={`cth: ${formatRupiah(nominal + 2000)}`}
                value={hasPrice ? sellPrice : ""}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  handlePriceChange(nominal, isNaN(val) ? undefined : val)
                }}
                disabled={disabled}
                className="w-28 h-8 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              {(hasPrice || isCustomNominal) ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemoveCustom(nominal)}
                  disabled={disabled}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <div className="w-7" />
              )}
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 items-center pt-1">
        <Input
          type="text"
          placeholder="Nominal lain, cth: 12000"
          value={newNominal}
          onChange={(e) => setNewNominal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddNominal()}
          disabled={disabled}
          className="flex-1 h-8 text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={handleAddNominal}
          disabled={disabled || !newNominal}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Tambah
        </Button>
      </div>
    </div>
  )
}

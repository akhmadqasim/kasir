import { useMemo, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button, Chip, Description, Fieldset, Input, NumberField, TextField } from "@heroui/react"

import { formatRupiah, parseIndonesianInteger } from "@/lib/format"

interface PpobCustomPricesProps {
  customPrices: Record<string, number>
  onCustomPricesChange: (prices: Record<string, number>) => void
  disabled: boolean
}

const PRESET_NOMINALS = [5000, 10000, 15000, 20000, 25000, 50000, 100000, 150000, 200000]

export function PpobCustomPrices({
  customPrices,
  onCustomPricesChange,
  disabled,
}: PpobCustomPricesProps) {
  const [newNominal, setNewNominal] = useState("")

  // Which rows exist is tracked separately from what they are priced at. Deriving the
  // list from `customPrices` alone meant a nominal without a price had no row, so the
  // add button did nothing and clearing a price mid-typing unmounted the input.
  const [extraNominals, setExtraNominals] = useState<number[]>([])

  const allNominals = useMemo(
    () =>
      Array.from(
        new Set([
          ...PRESET_NOMINALS,
          ...Object.keys(customPrices)
            .map(Number)
            .filter((n) => Number.isFinite(n) && n > 0),
          ...extraNominals,
        ]),
      ).sort((a, b) => a - b),
    [customPrices, extraNominals],
  )

  const rememberNominal = (nominal: number) => {
    setExtraNominals((prev) => (prev.includes(nominal) ? prev : [...prev, nominal]))
  }

  const handlePriceChange = (nominal: number, sellPrice: number | undefined) => {
    const updated = { ...customPrices }
    if (sellPrice === undefined || sellPrice <= 0) {
      delete updated[String(nominal)]
      // Keep the row while the field is empty so the input holds focus.
      if (!PRESET_NOMINALS.includes(nominal)) rememberNominal(nominal)
    } else {
      updated[String(nominal)] = sellPrice
    }
    onCustomPricesChange(updated)
  }

  const handleAddNominal = () => {
    const parsed = parseIndonesianInteger(newNominal)
    if (parsed === null || parsed <= 0) return
    rememberNominal(parsed)
    setNewNominal("")
  }

  const handleRemoveCustom = (nominal: number) => {
    const updated = { ...customPrices }
    delete updated[String(nominal)]
    onCustomPricesChange(updated)
    // Presets always keep their row; only a custom nominal leaves the list.
    if (!PRESET_NOMINALS.includes(nominal)) {
      setExtraNominals((prev) => prev.filter((n) => n !== nominal))
    }
  }

  return (
    <Fieldset>
      <Fieldset.Legend>Harga Jual Pulsa per Nominal</Fieldset.Legend>
      <Description>
        Berlaku untuk semua provider. Nominal tanpa harga pakai markup umum.
      </Description>

      <div className="grid gap-2">
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-1 text-xs text-muted">
          <span>Nominal</span>
          <span className="w-28 text-center">Harga Jual</span>
          <span aria-hidden="true" className="w-9 md:w-8" />
        </div>
        {allNominals.map((nominal) => {
          const sellPrice = customPrices[String(nominal)]
          const hasPrice = sellPrice !== undefined && sellPrice > 0
          const isCustomNominal = !PRESET_NOMINALS.includes(nominal)

          return (
            <div key={nominal} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium tabular-nums">{formatRupiah(nominal)}</span>
                {isCustomNominal && <Chip size="sm">custom</Chip>}
              </div>
              {/* NumberField replaces `<input type="number">` and the CSS that used to
                  hide its spinners. Grouping is off on purpose: React Aria parses with
                  the runtime locale, and the app ships no I18nProvider, so a grouped
                  "12.000" would read as 12 on an en-US webview. */}
              <NumberField
                aria-label={`Harga jual untuk nominal ${formatRupiah(nominal)}`}
                className="w-28"
                formatOptions={{ useGrouping: false, maximumFractionDigits: 0 }}
                isDisabled={disabled}
                minValue={0}
                value={hasPrice ? sellPrice : Number.NaN}
                variant="secondary"
                onChange={(value) =>
                  handlePriceChange(
                    nominal,
                    value === undefined || Number.isNaN(value) ? undefined : value,
                  )
                }
              >
                <NumberField.Group>
                  <NumberField.Input
                    className="text-right tabular-nums"
                    placeholder={`cth: ${formatRupiah(nominal + 2000)}`}
                  />
                </NumberField.Group>
              </NumberField>
              {hasPrice || isCustomNominal ? (
                <Button
                  aria-label={`Hapus harga nominal ${formatRupiah(nominal)}`}
                  isDisabled={disabled}
                  isIconOnly
                  size="sm"
                  variant="danger-soft"
                  onPress={() => handleRemoveCustom(nominal)}
                >
                  <Trash2 />
                </Button>
              ) : (
                // Selebar tombol `sm` ikon-saja, supaya kolom nominal tidak bergeser
                // antara baris yang punya tombol hapus dan yang tidak.
                <span aria-hidden="true" className="w-9 md:w-8" />
              )}
            </div>
          )
        })}
      </div>

      <Fieldset.Actions>
        <TextField
          aria-label="Nominal lain"
          className="flex-1"
          isDisabled={disabled}
          value={newNominal}
          variant="secondary"
          onChange={setNewNominal}
        >
          <Input
            className="tabular-nums"
            placeholder="Nominal lain, cth: 12000"
            onKeyDown={(e) => e.key === "Enter" && handleAddNominal()}
          />
        </TextField>
        <Button isDisabled={disabled || !newNominal} variant="secondary" onPress={handleAddNominal}>
          <Plus />
          Tambah
        </Button>
      </Fieldset.Actions>
    </Fieldset>
  )
}

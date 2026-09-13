import { Save } from "lucide-react"
import { Card, Description, Fieldset, NumberField } from "@heroui/react"

import { OptionSelect } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import { id } from "@/i18n/id"
import { isEmptyNumberFieldValue } from "@/lib/number-field"
import { PpobCustomPrices } from "./ppob-custom-prices"
import type { PpobSettingsForm } from "./use-ppob-settings-form"

type MarkupServiceKey = "pulsa" | "data" | "pln" | "pdam" | "bpjs" | "emoney"

const MARKUP_SERVICES: { key: MarkupServiceKey; label: string }[] = [
  { key: "pulsa", label: "Pulsa" },
  { key: "data", label: "Data" },
  { key: "pln", label: "PLN" },
  { key: "pdam", label: "PDAM" },
  { key: "bpjs", label: "BPJS" },
  { key: "emoney", label: "E-Money" },
]

const MARKUP_TYPES = [
  { key: "fixed", label: "Nominal (Rp)" },
  { key: "percentage", label: "Persentase (%)" },
] as const

/** Kartu markup per layanan dan harga jual pulsa per nominal. */
export function MarkupCard({ form }: { form: PpobSettingsForm }) {
  const { markup, updateMarkup } = form
  const disabled = !form.connection.enabled

  return (
    <Card>
      <Card.Header>
        <Card.Title>Markup & Harga Jual</Card.Title>
        <Card.Description>Atur margin keuntungan untuk setiap jenis layanan PPOB</Card.Description>
      </Card.Header>
      <Card.Content className="gap-6">
        {/* Dua kelompok isian dalam satu kartu: `Fieldset` memberi legenda dan
            keterangannya bentuk yang sama tanpa judul kartu kedua. */}
        <Fieldset>
          <Fieldset.Legend>Markup per Layanan</Fieldset.Legend>
          <Description>Harga jual = harga modal + markup</Description>
          <Fieldset.Group>
            {MARKUP_SERVICES.map(({ key, label }) => {
              const config = markup[key]
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-20 text-sm font-medium">{label}</span>
                  <OptionSelect
                    aria-label={`Tipe markup ${label}`}
                    className="w-32"
                    isDisabled={disabled}
                    options={MARKUP_TYPES}
                    value={config.type}
                    variant="secondary"
                    onChange={(value) => {
                      if (value === null) return
                      const type = value === "percentage" ? "percentage" : "fixed"
                      updateMarkup((prev) => ({ ...prev, [key]: { ...prev[key], type } }))
                    }}
                  />
                  <NumberField
                    aria-label={`Nilai markup ${label}`}
                    className="w-28"
                    formatOptions={{ maximumFractionDigits: 2 }}
                    isDisabled={disabled}
                    minValue={0}
                    value={config.value > 0 ? config.value : Number.NaN}
                    variant="secondary"
                    onChange={(value) => {
                      const next = isEmptyNumberFieldValue(value) ? 0 : value
                      updateMarkup((prev) => ({ ...prev, [key]: { ...prev[key], value: next } }))
                    }}
                  >
                    <NumberField.Group>
                      <NumberField.Input
                        className="text-right tabular-nums"
                        placeholder={config.type === "fixed" ? "cth: 2000" : "cth: 5"}
                      />
                    </NumberField.Group>
                  </NumberField>
                  <span className="text-sm text-muted">{config.type === "fixed" ? "Rp" : "%"}</span>
                </div>
              )
            })}
          </Fieldset.Group>
        </Fieldset>

        <PpobCustomPrices
          customPrices={markup.custom_prices}
          onCustomPricesChange={(prices) =>
            updateMarkup((prev) => ({ ...prev, custom_prices: prices }))
          }
          disabled={disabled}
        />
      </Card.Content>
      <Card.Footer>
        <PendingButton isDisabled={!form.isReady} isPending={form.isSaving} onPress={form.save}>
          <Save />
          {id.common.save}
        </PendingButton>
      </Card.Footer>
    </Card>
  )
}

import { Description, Fieldset, Label, NumberField } from "@heroui/react"

import { RupiahField } from "@/components/rupiah-field"
import { id } from "@/i18n/id"
import { formatPercent, formatRupiah } from "@/lib/format"
import { isEmptyNumberFieldValue } from "@/lib/number-field"
import { markupFromPrices } from "../product-form"

interface ProductPriceFieldsProps {
  buyPrice: number | null
  margin: number | null
  sellPrice: number | null
  /** Satuan produk, untuk kalimat "untung Rp X per <satuan>". */
  unit: string
  buyPriceError?: string
  sellPriceError?: string
  onBuyPriceChange: (value: number | null) => void
  onMarginChange: (value: number | null) => void
  onSellPriceChange: (value: number | null) => void
}

/** Harga modal × markup = harga jual, dengan untung/rugi per satuan di bawahnya. */
export function ProductPriceFields({
  buyPrice,
  margin,
  sellPrice,
  unit,
  buyPriceError,
  sellPriceError,
  onBuyPriceChange,
  onMarginChange,
  onSellPriceChange,
}: ProductPriceFieldsProps) {
  const markup = markupFromPrices(buyPrice, sellPrice)
  const profit = markup != null && buyPrice != null && sellPrice != null ? sellPrice - buyPrice : 0

  return (
    // Ketiga kolom berdiri langsung di atas permukaan dialog, tanpa
    // `InfoPanel`: kolom `secondary` di atas `Surface secondary` menyatu
    // dengan latarnya. Yang mengelompokkan mereka adalah `Fieldset`,
    // bukan kotak abu-abu.
    <Fieldset className="gap-3">
      {/* `legend` bukan anak flex fieldset, jadi `gap-3` tidak berlaku
          untuknya — tanpa `mb-2` ia menempel pada label di bawahnya dan
          terbaca sebagai label keempat, bukan judul kelompok. */}
      <Fieldset.Legend className="mb-2 text-sm font-semibold">Perhitungan Harga</Fieldset.Legend>
      <Fieldset.Group className="grid grid-cols-[1fr_auto_auto_auto_1fr] items-end gap-2 space-y-0">
        <RupiahField
          errorMessage={buyPriceError}
          isRequired
          label={id.products.buyPrice}
          placeholder="0"
          value={buyPrice}
          onChange={onBuyPriceChange}
        />

        <span aria-hidden="true" className="pb-2.5 text-base font-medium text-muted">
          ×
        </span>

        {/* `NumberField` memformat menurut locale aplikasi (`id-ID`, koma
            desimal) dan baru melaporkan nilainya saat kolom ditinggalkan;
            harga jual dihitung ulang saat itu. Kolom kosong diwakili `NaN`,
            bukan `undefined`: `undefined` membuatnya beralih ke mode tak
            terkendali, dan React Aria tidak mengizinkan berpindah mode. */}
        <NumberField
          className="w-24"
          formatOptions={{ maximumFractionDigits: 2 }}
          minValue={0}
          value={margin ?? Number.NaN}
          variant="secondary"
          onChange={(value) => onMarginChange(isEmptyNumberFieldValue(value) ? null : value)}
        >
          <Label>Markup (%)</Label>
          <NumberField.Group>
            <NumberField.Input className="text-right tabular-nums" placeholder="0" />
          </NumberField.Group>
        </NumberField>

        <span aria-hidden="true" className="pb-2.5 text-base font-medium text-muted">
          =
        </span>

        <RupiahField
          errorMessage={sellPriceError}
          isRequired
          label={id.products.sellPrice}
          placeholder="0"
          value={sellPrice}
          onChange={onSellPriceChange}
        />
      </Fieldset.Group>
      {/* Angka yang ditampilkan adalah markup (untung dibagi modal), jadi
          namanya markup — label lama "Margin aktual" menyebutnya margin.
          Harga jual di bawah modal ditandai dengan kata, bukan warna saja. */}
      {markup != null &&
        (profit < 0 ? (
          <Description className="text-danger">
            Harga jual di bawah modal — rugi{" "}
            <span className="font-semibold tabular-nums">{formatRupiah(-profit)}</span> per {unit}
          </Description>
        ) : (
          <Description>
            Untung{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {formatRupiah(profit)}
            </span>{" "}
            per {unit} · markup{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {formatPercent(markup)}%
            </span>
          </Description>
        ))}
    </Fieldset>
  )
}

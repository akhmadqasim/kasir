import type { ReactNode } from "react"
import {
  Description,
  FieldError,
  Label,
  ListBox,
  Select,
  type SelectRootProps,
} from "@heroui/react"

import { selectedText } from "./selected-text"

export interface SelectOption {
  key: string
  label: string
}

export interface OptionSelectProps extends Omit<
  SelectRootProps<object>,
  "children" | "value" | "onChange" | "items"
> {
  options: readonly SelectOption[]
  /** Kunci yang terpilih; `null` = belum ada pilihan (placeholder tampil). */
  value: string | null
  /** `null` hanya datang dari `Select.ClearButton`, yang tidak dipakai di sini. */
  onChange: (key: string | null) => void
  /** Label terlihat di atas kolom. Tanpa ini, beri `aria-label`. */
  label?: ReactNode
  /** Keterangan di bawah kolom; disembunyikan HeroUI saat kolom invalid. */
  description?: ReactNode
  /** Pesan validasi; kolom otomatis ditandai invalid saat pesan ini terisi. */
  errorMessage?: string
}

/**
 * `Select` untuk daftar pilihan statis — status, alasan, peran, satuan, metode
 * pembayaran.
 *
 * Susunan lengkapnya dari dokumentasi Select HeroUI (`Trigger` berisi `Value`
 * dan `Indicator`, `Popover` berisi `ListBox`, tiap item `Label` dan
 * `ItemIndicator`) memakan dua puluh baris, dan delapan layar menyalinnya untuk
 * daftar yang isinya cuma pasangan kunci–label. Ini menulisnya sekali; pemakai
 * tinggal memberi `options`.
 *
 * `Select.Value` diisi `selectedText` supaya pemicunya hanya menampilkan teks
 * pilihan, bukan salinan seluruh isi item beserta centangnya.
 */
export function OptionSelect({
  options,
  value,
  onChange,
  label,
  description,
  errorMessage,
  isInvalid,
  ...props
}: OptionSelectProps) {
  return (
    <Select
      isInvalid={isInvalid ?? Boolean(errorMessage)}
      value={value}
      onChange={(key) => onChange(key == null ? null : String(key))}
      {...props}
    >
      {label ? <Label>{label}</Label> : null}
      <Select.Trigger>
        <Select.Value>{selectedText}</Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      {description ? <Description>{description}</Description> : null}
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
              <Label>{option.label}</Label>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
      {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
    </Select>
  )
}

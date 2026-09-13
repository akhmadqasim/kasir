import { ComboBox, EmptyState, FieldError, Input, ListBox } from "@heroui/react"

import { BANKS, bankMatchesQuery } from "../../banks"

interface TransferFieldsProps {
  /** Nama bank yang sudah diketik/dipilih; string kosong = belum diisi. */
  value: string
  onChange: (value: string) => void
  onFocus?: () => void
  errorMessage?: string
}

function filterBank(itemText: string, query: string): boolean {
  const bank = BANKS.find((candidate) => candidate.name === itemText)
  if (!bank) return itemText.toLowerCase().includes(query.trim().toLowerCase())
  return bankMatchesQuery(bank, query)
}

/**
 * Nama bank pengirim untuk pembayaran transfer. `ComboBox` dengan
 * `allowsCustomValue`: daftar `BANKS` menyaring lewat nama dan alias saat
 * kasir mengetik (`bsi`, `syariah` → BSI), tapi bank yang tidak ada di
 * daftar tetap bisa diketik dan dipakai apa adanya — BPD kecil dan bank baru
 * tidak semuanya masuk daftar.
 */
export function TransferFields({ value, onChange, onFocus, errorMessage }: TransferFieldsProps) {
  return (
    // Tanpa label terlihat: kolom ini menempel di bawah "Nominal Transfer Bank"
    // dan judul "Bank" sendiri terbaca seperti metode pembayaran lain.
    <ComboBox
      allowsCustomValue
      aria-label="Bank"
      defaultFilter={filterBank}
      fullWidth
      inputValue={value}
      isInvalid={Boolean(errorMessage)}
      variant="secondary"
      onFocus={onFocus}
      onInputChange={onChange}
    >
      <ComboBox.InputGroup>
        <Input placeholder="Bank pengirim — pilih atau ketik" />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <ComboBox.Popover>
        <ListBox
          aria-label="Bank"
          renderEmptyState={() => (
            <EmptyState>Tidak ada di daftar — nama yang diketik tetap dipakai</EmptyState>
          )}
        >
          {BANKS.map((bank) => (
            <ListBox.Item key={bank.name} id={bank.name} textValue={bank.name}>
              {bank.name}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </ComboBox.Popover>
      {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
    </ComboBox>
  )
}

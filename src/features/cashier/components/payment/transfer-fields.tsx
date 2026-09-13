import { ComboBox, EmptyState, FieldError, Input, ListBox } from "@heroui/react"

import { BANKS, bankMatchesQuery } from "../../banks"
import { BankLogo } from "./bank-logo"

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

/** Bank yang namanya persis sama dengan teks yang sedang diketik/dipilih. */
function findBankByExactName(value: string): (typeof BANKS)[number] | undefined {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return undefined
  return BANKS.find((bank) => bank.name.toLowerCase() === normalized)
}

/**
 * Nama bank pengirim untuk pembayaran transfer — opsional; kosong berarti
 * struk dan laporan cuma menyebut "Transfer Bank". `ComboBox` dengan
 * `allowsCustomValue`: daftar `BANKS` menyaring lewat nama dan alias saat
 * kasir mengetik (`bsi`, `syariah` → BSI), tapi bank yang tidak ada di
 * daftar tetap bisa diketik dan dipakai apa adanya — BPD kecil dan bank baru
 * tidak semuanya masuk daftar.
 */
export function TransferFields({ value, onChange, onFocus, errorMessage }: TransferFieldsProps) {
  const matchedBank = findBankByExactName(value)

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
        {/* Diposisikan absolut seperti `ComboBox.Trigger` di ujung satunya —
            `ComboBox.InputGroup` tidak punya slot Prefix seperti `InputGroup`
            biasa, jadi logonya melayang di atas kolom, dan `Input` diberi
            `ps-9` supaya teksnya tidak tertindih. */}
        <BankLogo className="absolute start-1.5 top-1/2 -translate-y-1/2" name={matchedBank?.name} />
        <Input className="ps-9" placeholder="Bank pengirim" />
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
              <BankLogo name={bank.name} />
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

import { ComboBox, EmptyState, FieldError, Input, ListBox } from "@heroui/react"

import { BANK_CHOICE_BY_METHOD, BANKS, bankMatchesQuery, type Bank } from "../../banks"
import { BankLogo } from "./bank-logo"

interface BankFieldProps {
  /** Metode pembayaran yang kolom ini milik — menentukan daftar dan placeholder. */
  method: string
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
function findBankByExactName(value: string): Bank | undefined {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return undefined
  return BANKS.find((bank) => bank.name.toLowerCase() === normalized)
}

/**
 * Bank/aplikasi di balik satu pembayaran non-tunai — bank pengirim untuk
 * transfer, bank kartu untuk debit, dompet digital untuk e-wallet, aplikasi
 * pembayar untuk QRIS (`BANK_CHOICE_BY_METHOD`). Opsional; kosong berarti
 * struk dan laporan cuma menyebut metodenya. `ComboBox` dengan
 * `allowsCustomValue`: daftarnya menyaring lewat nama dan alias saat kasir
 * mengetik (`bsi`, `syariah` → BSI), tapi nama yang tidak ada di daftar
 * tetap bisa diketik dan dipakai apa adanya — BPD kecil dan bank baru tidak
 * semuanya masuk daftar.
 */
export function BankField({ method, value, onChange, onFocus, errorMessage }: BankFieldProps) {
  const matchedBank = findBankByExactName(value)
  const choice = BANK_CHOICE_BY_METHOD[method] ?? BANK_CHOICE_BY_METHOD.transfer!

  return (
    // Tanpa label terlihat: kolom ini menempel di bawah "Nominal <metode>"
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
        <Input className="ps-9" placeholder={choice.placeholder} />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <ComboBox.Popover>
        <ListBox
          aria-label="Bank"
          renderEmptyState={() => (
            <EmptyState>Tidak ada di daftar — nama yang diketik tetap dipakai</EmptyState>
          )}
        >
          {choice.options.map((bank) => (
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

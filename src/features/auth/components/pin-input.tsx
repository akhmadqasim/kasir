import { Description, FieldError, Input, Label, TextField } from "@heroui/react"

interface PinInputProps {
  /**
   * Label kolom. React Aria menghubungkan label ke input lewat context, jadi
   * layar cukup mengisi prop ini; tidak ada lagi `htmlFor` dari luar sejak dialog
   * pengguna ikut pindah ke HeroUI. Kalau dikosongkan, kolomnya memakai
   * `aria-label="PIN"` supaya tetap punya nama.
   */
  label?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Keterangan di bawah kolom, mis. "Kosongkan jika tidak ingin mengubah PIN". */
  description?: string
  /** Pesan validasi; kolom otomatis ditandai invalid saat pesan ini terisi. */
  errorMessage?: string
  isDisabled?: boolean
  autoFocus?: boolean
}

/** Kolom PIN kasir: hanya menerima angka, 4-6 digit, disembunyikan seperti password. */
export function PinInput({
  label,
  value,
  onChange,
  placeholder,
  description,
  errorMessage,
  isDisabled,
  autoFocus,
}: PinInputProps) {
  return (
    <TextField
      autoFocus={autoFocus}
      fullWidth
      isDisabled={isDisabled}
      isInvalid={Boolean(errorMessage)}
      maxLength={6}
      minLength={4}
      type="password"
      value={value}
      onChange={(next) => onChange(next.replace(/\D/g, ""))}
    >
      {label && <Label>{label}</Label>}
      <Input aria-label={label ? undefined : "PIN"} inputMode="numeric" placeholder={placeholder} />
      {description && <Description>{description}</Description>}
      {errorMessage && <FieldError>{errorMessage}</FieldError>}
    </TextField>
  )
}

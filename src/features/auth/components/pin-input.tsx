import type { Ref } from "react"
import {
  Description,
  FieldError,
  Input,
  Label,
  TextField,
  type TextFieldProps,
} from "@heroui/react"

interface PinInputProps {
  /** `secondary` bila kolomnya berdiri di atas `Card`/`Surface`, seperti di halaman login. */
  variant?: TextFieldProps["variant"]
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
  /** Untuk memindahkan fokus ke kolom ini dari kolom sebelumnya. */
  inputRef?: Ref<HTMLInputElement>
  /**
   * Dipanggil saat Enter ditekan di kolom ini. Layar login memakainya untuk
   * masuk tanpa memindahkan tangan ke mouse; lihat komentar di `login-page`.
   */
  onEnter?: () => void
}

/** Kolom PIN kasir: hanya menerima angka, 4-6 digit, disembunyikan seperti password. */
export function PinInput({
  variant,
  label,
  value,
  onChange,
  placeholder,
  description,
  errorMessage,
  isDisabled,
  autoFocus,
  inputRef,
  onEnter,
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
      variant={variant}
      onChange={(next) => onChange(next.replace(/\D/g, ""))}
    >
      {label && <Label>{label}</Label>}
      <Input
        ref={inputRef}
        aria-label={label ? undefined : "PIN"}
        inputMode="numeric"
        placeholder={placeholder}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !onEnter) return
          event.preventDefault()
          onEnter()
        }}
      />
      {description && <Description>{description}</Description>}
      {errorMessage && <FieldError>{errorMessage}</FieldError>}
    </TextField>
  )
}

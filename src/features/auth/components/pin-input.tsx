import { Input, Label, TextField } from "@heroui/react"

interface PinInputProps {
  /**
   * Label kolom. React Aria menghubungkan label ke input lewat context, jadi
   * layar yang sudah memakai HeroUI cukup mengisi prop ini. Layar yang masih
   * memasang label sendiri (dialog pengguna, masih shadcn) mengosongkannya dan
   * mengisi `id` supaya `htmlFor` eksternal tetap terhubung.
   */
  label?: string
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  isDisabled?: boolean
  autoFocus?: boolean
}

/** Kolom PIN kasir: hanya menerima angka, 4-6 digit, disembunyikan seperti password. */
export function PinInput({
  label,
  id,
  value,
  onChange,
  placeholder,
  isDisabled,
  autoFocus,
}: PinInputProps) {
  return (
    <TextField
      autoFocus={autoFocus}
      fullWidth
      isDisabled={isDisabled}
      maxLength={6}
      minLength={4}
      type="password"
      value={value}
      onChange={(next) => onChange(next.replace(/\D/g, ""))}
    >
      {label && <Label>{label}</Label>}
      <Input
        aria-label={label ? undefined : "PIN"}
        id={id}
        inputMode="numeric"
        placeholder={placeholder}
      />
    </TextField>
  )
}

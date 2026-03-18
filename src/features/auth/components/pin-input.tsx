import { Input } from "@/components/ui/input"

interface PinInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  id?: string
}

export function PinInput({
  value,
  onChange,
  placeholder,
  disabled,
  autoFocus,
  id,
}: PinInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const filtered = e.target.value.replace(/\D/g, "")
    onChange(filtered)
  }

  return (
    <Input
      id={id}
      type="password"
      inputMode="numeric"
      maxLength={6}
      minLength={4}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  )
}

import { id } from "@kasir/shared";
import { Description, FieldError, Input, Label, TextField } from "heroui-native";
import type { JSX } from "react";

interface NumberFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** `null` means the text does not parse; the field shows the standard error. */
  parsed: number | null;
  /** A rule the parsed value broke, shown instead of the parse error. */
  error?: string | null;
  description?: string;
  placeholder?: string;
  /** Rupiah fields accept `14.000`; integer fields do not. */
  decimal?: boolean;
  isRequired?: boolean;
  autoFocus?: boolean;
  returnKeyType?: "done" | "next";
  onSubmitEditing?: () => void;
}

/**
 * A numeric input that keeps the *text* the user typed and reports the number
 * separately. Indonesian typing habits (`14.000` for fourteen thousand) are
 * handled by the caller via `parseIndonesianNumber`, so this component never
 * reformats the text under the user's fingers.
 */
export function NumberField({
  label,
  value,
  onChangeText,
  parsed,
  error,
  description,
  placeholder,
  decimal = false,
  isRequired,
  autoFocus,
  returnKeyType = "done",
  onSubmitEditing,
}: NumberFieldProps): JSX.Element {
  const invalidText = value.trim().length > 0 && parsed === null;
  const message = error ?? (invalidText ? id.common.invalidNumber : null);

  return (
    <TextField isRequired={isRequired} isInvalid={message !== null}>
      <Label>{label}</Label>
      <Input
        value={value}
        onChangeText={onChangeText}
        keyboardType={decimal ? "decimal-pad" : "number-pad"}
        placeholder={placeholder}
        autoFocus={autoFocus}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        selectTextOnFocus
      />
      {message ? <FieldError>{message}</FieldError> : null}
      {!message && description ? <Description>{description}</Description> : null}
    </TextField>
  );
}

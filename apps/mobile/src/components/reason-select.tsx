import { id, writeoffReasonLabel, type WriteoffReason } from "@kasir/shared";
import { Description, Label, Select, TextField } from "heroui-native";
import type { JSX } from "react";

interface ReasonSelectProps {
  /** Already filtered for the role by `allowedWriteoffReasons`. */
  reasons: readonly WriteoffReason[];
  value: WriteoffReason | null;
  onChange: (reason: WriteoffReason) => void;
  description?: string;
}

/** Write-off reason picker. Only the reasons this role may use are offered. */
export function ReasonSelect({
  reasons,
  value,
  onChange,
  description,
}: ReasonSelectProps): JSX.Element {
  return (
    <TextField isRequired>
      <Label>{id.stock.reason}</Label>
      <Select
        value={value ? { value, label: writeoffReasonLabel(value) } : undefined}
        onValueChange={(option) => {
          if (!option || Array.isArray(option)) return;
          onChange(option.value as WriteoffReason);
        }}
      >
        <Select.Trigger>
          <Select.Value placeholder={id.stock.reason} />
          <Select.TriggerIndicator />
        </Select.Trigger>
        <Select.Portal>
          <Select.Overlay />
          <Select.Content presentation="popover">
            {reasons.map((reason) => (
              <Select.Item key={reason} value={reason} label={writeoffReasonLabel(reason)} />
            ))}
          </Select.Content>
        </Select.Portal>
      </Select>
      {description ? <Description>{description}</Description> : null}
    </TextField>
  );
}

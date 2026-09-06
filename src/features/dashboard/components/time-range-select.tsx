import { Label, ListBox, Select } from "@heroui/react"

import { selectedText } from "@/components/selected-text"
import { TIME_RANGE_OPTIONS, type TimeRangeKey } from "./time-range"

export interface TimeRangeSelectProps {
  value: TimeRangeKey
  onChange: (value: TimeRangeKey) => void
}

export function TimeRangeSelect({ value, onChange }: TimeRangeSelectProps) {
  return (
    <Select
      aria-label="Rentang waktu grafik"
      className="w-36"
      value={value}
      onChange={(next) => onChange(String(next) as TimeRangeKey)}
    >
      <Select.Trigger>
        <Select.Value>{selectedText}</Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {TIME_RANGE_OPTIONS.map((option) => (
            <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
              <Label>{option.label}</Label>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}

import { Button, Dropdown, Label } from "@heroui/react"
import { CalendarIcon, ChevronDownIcon } from "lucide-react"

import { TIME_RANGE_OPTIONS, type TimeRangeKey } from "./time-range"

export interface TimeRangeMenuProps {
  value: TimeRangeKey
  onChange: (value: TimeRangeKey) => void
}

/**
 * Pemilih rentang waktu di baris kendali dashboard: satu tombol `sm tertiary`
 * — ikon kalender, periode aktif, chevron — yang membuka `Dropdown`.
 *
 * Template dashboard HeroUI Pro memakai `ButtonGroup` dua tombol di posisi
 * ini, tapi split-button ada untuk dua aksi yang berbeda, dan di sini keduanya
 * akan membuka menu yang sama. Meniru bentuknya sempat memaksa state `isOpen`
 * manual dan penulisan ulang varian pada tombol kedua; satu pemicu tidak butuh
 * keduanya. Rupanya nyaris sama, kontrolnya jujur.
 */
export function TimeRangeMenu({ value, onChange }: TimeRangeMenuProps) {
  const current = TIME_RANGE_OPTIONS.find((option) => option.key === value)

  return (
    <Dropdown>
      <Button aria-label="Ganti rentang waktu" size="sm" variant="tertiary">
        <CalendarIcon />
        {current?.label}
        <ChevronDownIcon />
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          selectedKeys={new Set([value])}
          selectionMode="single"
          onSelectionChange={(keys) => {
            const [next] = [...keys]
            if (typeof next === "string") onChange(next as TimeRangeKey)
          }}
        >
          {TIME_RANGE_OPTIONS.map((option) => (
            <Dropdown.Item key={option.key} id={option.key} textValue={option.label}>
              <Dropdown.ItemIndicator />
              <Label>{option.label}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

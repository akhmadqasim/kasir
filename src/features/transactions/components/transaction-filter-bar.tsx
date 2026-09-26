import { X } from "lucide-react"
import { Button, ToggleButton, ToggleButtonGroup } from "@heroui/react"

import { DateRangePicker } from "@/components/date-range-picker"
import { OptionSelect } from "@/components/option-select"
import { SearchInput } from "@/components/search-input"
import { id } from "@/i18n/id"
import {
  ALL,
  CHANNEL_FILTERS,
  PAYMENT_METHOD_FILTERS,
  STATUS_FILTERS,
  type TransactionFilters,
} from "../transaction-filters"

interface TransactionFilterBarProps {
  filters: TransactionFilters
  onChange: (patch: Partial<TransactionFilters>) => void
  /** Shown only while some filter differs from the default. */
  onReset?: () => void
}

/** Channel, search, method, status and date range for the transaction history. */
export function TransactionFilterBar({ filters, onChange, onReset }: TransactionFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Radiogroup, bukan Select: tiga pilihan yang selalu terlihat, dan
          kasir langsung tahu sedang melihat penjualan atau tagihan PPOB. */}
      <ToggleButtonGroup
        aria-label={id.transactions.channelFilter}
        disallowEmptySelection
        selectedKeys={[filters.channel]}
        selectionMode="single"
        onSelectionChange={(keys) => {
          const [next] = [...keys]
          const picked = CHANNEL_FILTERS.find((option) => option.key === next)
          if (picked) onChange({ channel: picked.key })
        }}
      >
        {CHANNEL_FILTERS.map((option, index) => (
          <ToggleButton key={option.key} id={option.key}>
            {index > 0 && <ToggleButtonGroup.Separator />}
            {option.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <SearchInput
        aria-label={id.transactions.searchPlaceholder}
        placeholder={id.transactions.searchPlaceholder}
        // Lentur: di 1366px dengan sidebar terbuka seluruh baris kendali muat
        // satu baris, pemilih tanggal tetap di ujung kanan (DESIGN.md §5.1).
        className="max-w-sm min-w-48 flex-1"
        value={filters.search}
        onChange={(search) => onChange({ search })}
      />

      <OptionSelect
        aria-label={id.transactions.paymentMethod}
        className="w-40"
        placeholder={id.transactions.allMethods}
        options={PAYMENT_METHOD_FILTERS}
        value={filters.paymentMethod || ALL}
        onChange={(key) => onChange({ paymentMethod: key === ALL || key === null ? "" : key })}
      />

      <OptionSelect
        aria-label={id.transactions.status}
        className="w-40"
        placeholder={id.transactions.allStatus}
        options={STATUS_FILTERS}
        value={filters.status || ALL}
        onChange={(key) => onChange({ status: key === ALL || key === null ? "" : key })}
      />

      {onReset && (
        <Button size="sm" variant="tertiary" onPress={onReset}>
          <X />
          {id.common.clearFilters}
        </Button>
      )}

      <div className="ml-auto">
        <DateRangePicker
          value={filters.dateRange}
          onChange={(dateRange) => onChange({ dateRange })}
          align="start"
        />
      </div>
    </div>
  )
}

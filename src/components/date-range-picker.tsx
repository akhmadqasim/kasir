import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import { CalendarIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { resolveRangeSelection, type DateRange } from "@/lib/date-range"

/** Label tombol: "01 Sep 2026 - 30 Sep 2026", satu tanggal, atau placeholder. */
function formatRangeLabel(range: DateRange | undefined) {
  if (!range?.from) return null
  const from = format(range.from, "dd MMM yyyy", { locale: idLocale })
  if (!range.to) return from
  return `${from} - ${format(range.to, "dd MMM yyyy", { locale: idLocale })}`
}

interface DateRangePickerProps {
  value: DateRange | undefined
  /**
   * Selalu dipanggil dengan rentang terisi: klik yang menghapus pilihan diterjemahkan
   * jadi rentang satu hari, lihat {@link resolveRangeSelection}.
   */
  onChange: (range: DateRange) => void
  /** Sisi popover yang disejajarkan dengan tombol. */
  align?: "start" | "center" | "end"
  /** Jumlah bulan yang ditampilkan berdampingan. */
  numberOfMonths?: number
}

/**
 * Pemilih rentang tanggal untuk semua layar laporan, riwayat transaksi, riwayat
 * refund dan riwayat PPOB.
 *
 * Bersama `@/lib/date-range` ini satu-satunya kode yang menyentuh
 * `react-day-picker`, jadi penggantian ke `DateRangePicker` HeroUI terkurung di
 * kedua modul itu.
 */
export function DateRangePicker({
  value,
  onChange,
  align = "end",
  numberOfMonths = 2,
}: DateRangePickerProps) {
  const label = formatRangeLabel(value)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          data-empty={!value?.from}
          className="justify-start px-2.5 font-normal data-[empty=true]:text-muted-foreground"
        >
          <CalendarIcon />
          {label ?? <span>Pilih tanggal</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="range"
          defaultMonth={value?.from}
          selected={value}
          onSelect={(range, triggerDate) =>
            onChange(resolveRangeSelection(range, triggerDate))
          }
          numberOfMonths={numberOfMonths}
          locale={idLocale}
        />
      </PopoverContent>
    </Popover>
  )
}

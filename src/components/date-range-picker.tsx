import {
  DateField,
  DateRangePicker as HeroDateRangePicker,
  I18nProvider,
  RangeCalendar,
} from "@heroui/react"

import {
  fromCalendarDateRange,
  resolveRangeSelection,
  toCalendarDateRange,
  type DateRange,
} from "@/lib/date-range"

/** `align` lama dipetakan ke penempatan popover React Aria. */
const POPOVER_PLACEMENT = {
  start: "bottom start",
  center: "bottom",
  end: "bottom end",
} as const

interface DateRangePickerProps {
  value: DateRange | undefined
  /**
   * Selalu dipanggil dengan rentang terisi: pilihan yang dikosongkan diterjemahkan
   * jadi rentang satu hari, lihat {@link resolveRangeSelection}.
   */
  onChange: (range: DateRange) => void
  /** Sisi popover yang disejajarkan dengan kolom tanggal. */
  align?: "start" | "center" | "end"
  /** Jumlah bulan yang ditampilkan berdampingan. */
  numberOfMonths?: number
}

/**
 * Pemilih rentang tanggal untuk semua layar laporan, riwayat transaksi, riwayat
 * refund dan riwayat PPOB.
 *
 * Bersama `@/lib/date-range` ini satu-satunya kode yang menyentuh tipe tanggal
 * React Aria; dua belas layar pemanggilnya tetap bicara dalam `Date` biasa.
 *
 * `I18nProvider` dipasang di sini, bukan di root aplikasi: `index.html` menyatakan
 * `lang="en"` dan React Aria jatuh ke `navigator.language`, jadi tanpa ini urutan
 * segmennya jadi bulan-hari-tahun dan nama bulannya bahasa Inggris — bacaan yang
 * salah untuk kasir Indonesia. Satu-satunya bagian aplikasi yang memformat tanggal
 * lewat React Aria adalah komponen ini, jadi cakupannya cukup di sini.
 */
export function DateRangePicker({
  value,
  onChange,
  align = "end",
  numberOfMonths = 2,
}: DateRangePickerProps) {
  const months = Array.from({ length: Math.max(1, numberOfMonths) }, (_, index) => index)

  return (
    <I18nProvider locale="id-ID">
      <HeroDateRangePicker
        aria-label="Rentang tanggal"
        value={toCalendarDateRange(value)}
        onChange={(next) =>
          onChange(resolveRangeSelection(fromCalendarDateRange(next), new Date()))
        }
      >
        <DateField.Group>
          <DateField.Input slot="start">
            {(segment) => <DateField.Segment segment={segment} />}
          </DateField.Input>
          <HeroDateRangePicker.RangeSeparator />
          <DateField.Input slot="end">
            {(segment) => <DateField.Segment segment={segment} />}
          </DateField.Input>
          <DateField.Suffix>
            <HeroDateRangePicker.Trigger>
              <HeroDateRangePicker.TriggerIndicator />
            </HeroDateRangePicker.Trigger>
          </DateField.Suffix>
        </DateField.Group>
        <HeroDateRangePicker.Popover placement={POPOVER_PLACEMENT[align]}>
          <RangeCalendar
            aria-label="Pilih rentang tanggal"
            className="w-max"
            visibleDuration={{ months: months.length }}
          >
            <div className="flex gap-6">
              {months.map((offset) => (
                <div key={offset} className="w-64">
                  <RangeCalendar.Header>
                    {offset === 0 ? (
                      <RangeCalendar.NavButton slot="previous" />
                    ) : (
                      <div className="size-6" />
                    )}
                    <RangeCalendar.Heading
                      className="flex-none"
                      offset={{ months: offset }}
                    />
                    {offset === months.length - 1 ? (
                      <RangeCalendar.NavButton slot="next" />
                    ) : (
                      <div className="size-6" />
                    )}
                  </RangeCalendar.Header>
                  <RangeCalendar.Grid offset={{ months: offset }}>
                    <RangeCalendar.GridHeader>
                      {(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}
                    </RangeCalendar.GridHeader>
                    <RangeCalendar.GridBody>
                      {(date) => <RangeCalendar.Cell date={date} />}
                    </RangeCalendar.GridBody>
                  </RangeCalendar.Grid>
                </div>
              ))}
            </div>
          </RangeCalendar>
        </HeroDateRangePicker.Popover>
      </HeroDateRangePicker>
    </I18nProvider>
  )
}

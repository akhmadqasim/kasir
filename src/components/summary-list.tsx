import { cn } from "@/lib/utils"

export interface SummaryItem {
  label: string
  value: string
  /**
   * Satu peran per baris, bukan tiga boolean yang bisa dinyalakan bersamaan.
   * `mono` untuk nomor identitas (HP, IDPEL, rekening) yang dibaca digit per
   * digit; `strong` untuk baris total yang harus tertangkap mata lebih dulu;
   * `success` / `danger` untuk nilai yang maknanya searah dengan warnanya —
   * margin yang menguntungkan toko, atau selisih yang harus dibayar.
   */
  tone?: "default" | "mono" | "strong" | "success" | "danger"
}

export interface SummaryListProps {
  items: SummaryItem[]
  /**
   * `row`: label kiri, nilai kanan — ringkasan pembayaran yang nilainya
   * dibandingkan antar baris, jadi harus rata kanan.
   * `grid`: kolom label selebar 120px, nilai mengikuti di kanannya — rincian
   * transaksi yang nilainya teks bebas (No. Referensi, Keterangan) dan lebih
   * enak dibaca rata kiri sejajar.
   */
  layout?: "row" | "grid"
}

const TONE_CLASS: Record<NonNullable<SummaryItem["tone"]>, string> = {
  default: "tabular-nums",
  mono: "font-mono",
  strong: "font-semibold tabular-nums",
  success: "text-success tabular-nums",
  danger: "text-danger tabular-nums",
}

/**
 * Daftar label–nilai. Naik dari `features/ppob` karena bentuk yang sama muncul
 * di lima fitur dengan lima penulisan `flex justify-between` yang bobot
 * hurufnya sedikit berbeda satu sama lain.
 *
 * `<dl>`, bukan `<div>`: pembaca layar membacanya sebagai pasangan istilah dan
 * nilai, yang memang begitu isinya.
 *
 * Nilai selalu `tabular-nums` kecuali `mono` — huruf mono sudah lebar tetap,
 * jadi penanda itu tidak menambah apa-apa.
 */
export function SummaryList({ items, layout = "row" }: SummaryListProps) {
  const isGrid = layout === "grid"
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            isGrid ? "grid grid-cols-[120px_1fr] gap-2" : "flex items-start justify-between gap-4",
          )}
        >
          <dt className="text-muted">{item.label}</dt>
          {/* `min-w-0 break-words`: nilai mentah dari vendor PPOB (token, nomor
              referensi) bisa berupa satu kata panjang tanpa spasi, dan tanpa ini
              ia mendorong kolom `1fr` melebar keluar dialog. */}
          <dd
            className={cn(
              "min-w-0 break-words",
              !isGrid && "text-right",
              TONE_CLASS[item.tone ?? "default"],
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

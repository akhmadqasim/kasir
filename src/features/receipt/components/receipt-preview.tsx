import { Skeleton } from "@heroui/react"

import { useApiQuery } from "@/hooks/use-api"
import { getSaleReceiptLines } from "@/lib/api/transactions"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"

/** Kolom struk 58mm dan 80mm — sama dengan `printing::receipt::columns` di Rust. */
const COLUMNS_58MM = 32
const COLUMNS_80MM = 42

interface ReceiptPreviewProps {
  transactionId: number
  /**
   * Lebar kertas dari pengaturan printer yang sama dipakai mencetak
   * (`printers.paper_width`). `null`/`undefined` = pengaturan belum termuat
   * atau belum diatur; backend lalu memakai bawaannya sendiri (58mm), dan
   * pratinjau ini mengikuti bawaan yang sama supaya tidak pernah salah tebak
   * lebar kolom.
   */
  paperWidth?: number | null
  /** Dilewatkan ke kotak kertasnya — mis. `max-h-*` supaya struk panjang menggulir di dalamnya. */
  className?: string
}

/**
 * Pratinjau struk persis seperti yang akan dicetak — baris yang sama persis
 * yang dikirim ke printer (`GET /transactions/{id}/receipt/lines`, dibangun
 * dari `printing::receipt::format_receipt_text` yang sama dengan pencetakan),
 * bukan HTML yang ditulis ulang di frontend dan bisa diam-diam berbeda dari
 * hasil cetaknya.
 */
export function ReceiptPreview({ transactionId, paperWidth, className }: ReceiptPreviewProps) {
  const columns = paperWidth === 80 ? COLUMNS_80MM : COLUMNS_58MM
  const { data: lines, isLoading } = useApiQuery(
    queryKeys.transactions.receiptLines(transactionId, paperWidth ?? null),
    () => getSaleReceiptLines(transactionId, paperWidth),
  )

  return (
    // `bg-white`/`text-black` mentah, bukan token tema: ini kertas termal
    // sungguhan, yang selalu putih terlepas dari tema gelap aplikasinya —
    // pengecualian yang sama dengan warna kategori di DESIGN.md §3.2.
    <div
      aria-label="Pratinjau struk"
      // `font-mono text-xs` di kotaknya, bukan hanya di teksnya: lebar `ch`
      // dihitung dari huruf elemen ini sendiri, dan dengan huruf sans 16px kotak
      // itu jadi sepertiga lebih lebar dari teksnya lalu meluber keluar dialog.
      className={cn(
        "mx-auto max-w-full overflow-auto rounded-md border border-border bg-white px-3 py-6 font-mono text-xs text-black shadow-xs [scrollbar-gutter:stable_both-edges] [scrollbar-width:thin]",
        className,
      )}
      // `+ 1.5rem` = `px-3` kiri dan kanan; `+ 1.5rem` lagi = jalur scrollbar
      // yang dipesan tetap di kedua sisi (`scrollbar-gutter`), supaya struk
      // panjang yang menggulir tidak kehilangan digit terakhirnya di balik
      // scrollbar, dan yang pendek tetap simetris. Atas-bawah lebih lega
      // seperti sisa kertas yang keluar sebelum dan sesudah cetakan.
      style={{ width: `calc(${columns}ch + 3rem)` }}
    >
      {!lines || isLoading ? (
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 14 }).map((_, index) => (
            <Skeleton key={index} className="h-3 w-full bg-black/10" />
          ))}
        </div>
      ) : (
        <div className="whitespace-pre">
          {lines.map((line, index) => (
            <div key={index} className={cn(line.bold && "font-bold")}>
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

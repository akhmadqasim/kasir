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
}

/**
 * Pratinjau struk persis seperti yang akan dicetak — baris yang sama persis
 * yang dikirim ke printer (`GET /transactions/{id}/receipt/lines`, dibangun
 * dari `printing::receipt::format_receipt_text` yang sama dengan pencetakan),
 * bukan HTML yang ditulis ulang di frontend dan bisa diam-diam berbeda dari
 * hasil cetaknya.
 */
export function ReceiptPreview({ transactionId, paperWidth }: ReceiptPreviewProps) {
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
      className="mx-auto overflow-x-auto rounded-md border border-border bg-white p-3 text-black shadow-xs"
      style={{ width: `${columns}ch` }}
    >
      {!lines || isLoading ? (
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 14 }).map((_, index) => (
            <Skeleton key={index} className="h-3 w-full bg-black/10" />
          ))}
        </div>
      ) : (
        <div className="font-mono text-xs whitespace-pre">
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

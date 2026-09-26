import { memo } from "react"
import { Pencil, Trash2 } from "lucide-react"
import { Button, Table } from "@heroui/react"

import { StatusBadge } from "@/components/status-badge"
import { id } from "@/i18n/id"
import { formatNumber, formatRupiah } from "@/lib/format"
import { cn } from "@/lib/utils"
import { PinActionButton } from "./pin-action-button"
import type { Product } from "../types"

interface ProductRowProps {
  product: Product
  /** Nama kategorinya, atau `null` untuk produk tanpa kategori. */
  categoryName: string | null
  isPinned: boolean
  /** `true` selama permintaan pin untuk baris ini berjalan. */
  isPinPending: boolean
  onEdit: (product: Product) => void
  onDelete: (product: Product) => void
  onTogglePin: (productId: number) => void
}

/**
 * Satu baris tabel produk.
 *
 * Di-`memo` karena tabel ini digambar ulang jauh lebih sering daripada
 * isinya berubah: React Aria menggambar ulang seluruh `Table.Content` setiap
 * fokus masuk atau keluar dari tabel — yang terjadi dua kali tiap dialog ubah
 * dibuka. Dengan lima puluh baris yang masing-masing berisi tiga tombol,
 * satu gambar ulang penuh memakan ratusan milidetik. Semua prop di sini
 * primitif atau stabil (objek produk datang dari cache React Query, yang
 * mempertahankan identitas baris yang tidak berubah), jadi baris yang tidak
 * berubah dilewati.
 */
export const ProductRow = memo(function ProductRow({
  product,
  categoryName,
  isPinned,
  isPinPending,
  onEdit,
  onDelete,
  onTogglePin,
}: ProductRowProps) {
  return (
    <Table.Row id={product.id} textValue={product.name}>
      {/* Tanpa lencana "Tanpa Barcode" / "Tanpa Kategori": kolom barcode dan
          kategori di baris yang sama sudah mengatakannya. */}
      {/* `text-pretty`: nama yang patah tidak menyisakan "g" atau "kg"
          sendirian di baris kedua pada layar 1024px. */}
      <Table.Cell className="font-medium text-pretty">{product.name}</Table.Cell>
      <Table.Cell className="text-muted tabular-nums">{product.barcode?.trim() || "—"}</Table.Cell>
      <Table.Cell>
        <span className={cn(!categoryName && "text-muted")}>
          {categoryName ?? "Tanpa kategori"}
        </span>
      </Table.Cell>
      <Table.Cell className="text-right tabular-nums">
        {formatRupiah(product.sell_price)}
      </Table.Cell>
      <Table.Cell className="text-right">
        {/* Lencananya di kiri angka, bukan di kanan: dengan lencana di kanan,
            angka baris "Stok Rendah" bergeser ke kiri dan kolomnya tidak lagi
            rata di tepi kanan seperti kolom angka lainnya. */}
        <div className="flex items-center justify-end gap-2">
          <StockBadge stock={product.stock} minStock={product.min_stock} />
          {/* Satuannya ikut tertulis: "12" untuk beras berarti kilogram, untuk
              mi berarti bungkus. */}
          <span className="whitespace-nowrap tabular-nums">
            <span className={cn(product.stock < 0 && "font-semibold text-danger")}>
              {formatNumber(product.stock)}
            </span>{" "}
            <span className="text-xs text-muted">{product.unit}</span>
          </span>
        </div>
      </Table.Cell>
      <Table.Cell className="text-right">
        {/* Aksi baris mengikuti contoh "Custom Cells" tabel HeroUI: `tertiary`
            untuk aksi biasa, `danger-soft` untuk hapus (DESIGN.md §5.4). */}
        <div className="flex items-center justify-end gap-1">
          <PinActionButton
            isPending={isPinPending}
            isPinned={isPinned}
            productName={product.name}
            onPress={() => onTogglePin(product.id)}
          />
          <Button
            aria-label={`${id.common.edit} ${product.name}`}
            isIconOnly
            preventFocusOnPress
            size="sm"
            variant="tertiary"
            onPress={() => onEdit(product)}
          >
            <Pencil />
          </Button>
          <Button
            aria-label={`${id.common.delete} ${product.name}`}
            isIconOnly
            preventFocusOnPress
            size="sm"
            variant="danger-soft"
            onPress={() => onDelete(product)}
          >
            <Trash2 />
          </Button>
        </div>
      </Table.Cell>
    </Table.Row>
  )
})

function StockBadge({ stock, minStock }: { stock: number; minStock: number }) {
  if (stock < 0) {
    return (
      <StatusBadge status="error" size="sm">
        Stok Minus
      </StatusBadge>
    )
  }
  if (stock === 0) {
    return (
      <StatusBadge status="error" size="sm">
        Stok Habis
      </StatusBadge>
    )
  }
  if (stock <= minStock) {
    return (
      <StatusBadge status="warning" size="sm">
        {id.products.lowStock}
      </StatusBadge>
    )
  }
  return null
}

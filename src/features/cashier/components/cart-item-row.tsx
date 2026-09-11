import { Button, Chip, Table } from "@heroui/react"
import { Smartphone, Zap, Droplet, ShieldCheck, Wallet, Wifi, Trash2 } from "lucide-react"

import type { CartItem } from "../types"
import { formatRupiah } from "../utils"

const PPOB_ICONS: Record<string, React.ElementType> = {
  pulsa: Smartphone,
  data: Wifi,
  pln: Zap,
  pdam: Droplet,
  bpjs: ShieldCheck,
  emoney: Wallet,
}

interface CartItemRowProps {
  item: CartItem
  onRemove: (cartId: string) => void
  onEdit: (item: CartItem) => void
  hasDiscount?: boolean
}

export function CartItemRow({ item, onRemove, onEdit, hasDiscount }: CartItemRowProps) {
  const subtotal = item.product_price * item.quantity
  const qty = item.is_ppob ? 1 : item.quantity
  const PpobIcon = PPOB_ICONS[item.service_type ?? ""] ?? Smartphone

  const truncatePpobName = (name: string) => {
    const parts = name.split(" - ")
    if (parts.length > 1) {
      return parts.slice(1).join(" - ").substring(0, 40)
    }
    return name.substring(0, 40)
  }

  return (
    <Table.Row id={item.cart_id} textValue={item.product_name} onAction={() => onEdit(item)}>
      <Table.Cell className="whitespace-normal">
        <div className="flex min-w-0 items-start gap-2">
          {/* Qty. PPOB selalu satu baris per tagihan, jadi lencananya netral
              dan tidak menonjol; barang fisik memakai aksen supaya jumlah yang
              bukan 1 langsung tertangkap mata saat kasir memindai keranjang. */}
          <Chip
            className="mt-0.5 shrink-0 tabular-nums"
            color={item.is_ppob ? "default" : "accent"}
            size="lg"
            variant={item.is_ppob ? "secondary" : "primary"}
          >
            {qty}
          </Chip>
          <div className="min-w-0">
            <p className="font-medium leading-snug">
              {item.is_ppob ? truncatePpobName(item.product_name) : item.product_name}
            </p>
            {item.is_ppob ? (
              <div className="mt-0.5 flex items-center gap-1">
                <PpobIcon className="h-3 w-3 shrink-0 text-muted" />
                <p className="text-xs text-muted">{item.service_ref}</p>
              </div>
            ) : (
              <p className="text-xs text-muted">
                {formatRupiah(item.product_price)} / {item.unit}
              </p>
            )}
            {hasDiscount && <p className="text-xs font-medium text-danger">Diskon aktif</p>}
          </div>
        </div>
      </Table.Cell>
      <Table.Cell className="text-right font-semibold tabular-nums">
        {formatRupiah(subtotal)}
      </Table.Cell>
      <Table.Cell>
        {/* React Aria tidak menjalankan `onAction` baris saat tombol di dalamnya
            ditekan, jadi tidak ada lagi `stopPropagation` yang perlu ditulis. */}
        <Button
          aria-label={`Hapus ${item.product_name}`}
          className="h-7 w-7"
          isIconOnly
          size="sm"
          variant="danger"
          onPress={() => onRemove(item.cart_id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </Table.Cell>
    </Table.Row>
  )
}

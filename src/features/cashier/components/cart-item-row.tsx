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

  // A PPOB line is named "<service> - <product>"; the icon under it already
  // says the service, so only the product part is shown. Long names wrap to
  // two lines instead of being cut mid-word at a fixed character count.
  const displayName = item.is_ppob
    ? item.product_name.split(" - ").slice(1).join(" - ") || item.product_name
    : item.product_name

  return (
    <Table.Row id={item.cart_id} textValue={item.product_name} onAction={() => onEdit(item)}>
      <Table.Cell className="whitespace-normal">
        <div className="flex min-w-0 items-start gap-2">
          {/* Qty sebagai `Chip` netral: satu bentuk untuk barang fisik dan PPOB.
              Lencana beraksen di setiap baris tidak lagi membedakan apa pun
              begitu semua baris memilikinya — DESIGN.md §5.4. */}
          <Chip className="shrink-0 tabular-nums" size="lg">
            {qty}
          </Chip>
          <div className="min-w-0">
            <p className="line-clamp-2 font-medium break-words" title={item.product_name}>
              {displayName}
            </p>
            {item.is_ppob ? (
              <p className="flex items-center gap-1 text-xs text-muted">
                <PpobIcon aria-hidden="true" className="size-3 shrink-0" />
                {item.service_ref}
              </p>
            ) : (
              <p className="text-xs text-muted">
                {formatRupiah(item.product_price)} / {item.unit}
              </p>
            )}
            {hasDiscount && <p className="text-xs font-medium text-danger">Diskon aktif</p>}
          </div>
        </div>
      </Table.Cell>
      <Table.Cell className="text-right font-medium tabular-nums">
        {formatRupiah(subtotal)}
      </Table.Cell>
      {/* `ps-0`: the subtotal cell's own padding already separates the two;
          doubled, it took the width the product name wraps in at 1024px. */}
      <Table.Cell className="ps-0">
        {/* React Aria tidak menjalankan `onAction` baris saat tombol di dalamnya
            ditekan, jadi tidak ada lagi `stopPropagation` yang perlu ditulis. */}
        <Button
          aria-label={`Hapus ${item.product_name}`}
          isIconOnly
          size="sm"
          // Row actions that destroy are `danger-soft` (DESIGN.md §5.4): a solid
          // red button on every line shouts louder than the total.
          variant="danger-soft"
          onPress={() => onRemove(item.cart_id)}
        >
          <Trash2 />
        </Button>
      </Table.Cell>
    </Table.Row>
  )
}

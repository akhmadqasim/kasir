import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Badge, Button, ScrollShadow, Separator, Table } from "@heroui/react"
import { PlayCircle, ShoppingCart } from "lucide-react"

import { id } from "@/i18n/id"
import { NoData } from "@/components/no-data"
import { formatNumber } from "@/lib/format"
import { toast } from "@/lib/toast"
import { useCartStore } from "@/stores/cart-store"
import { CashFlowDialog, useShiftStore } from "@/features/shift"
import { CartFooter } from "./cart-footer"
import { CartItemRow } from "./cart-item-row"
import { CartItemEditDialog } from "./cart-item-edit-dialog"
import { DiscountDialog } from "./discount-dialog"
import { HeldCartsDialog } from "./held-carts-dialog"
import { HoldCartDialog } from "./hold-cart-dialog"
import { ShortcutKey } from "./shortcut-key"
import type { CartItem } from "../types"

interface CartPanelProps {
  onPay: () => void
  /** Why Bayar is off even with items in the cart (no shift open), shown under it. */
  payBlockedReason?: string
  /** Matikan shortcut saat dialog milik CashierPage sedang terbuka */
  shortcutsDisabled?: boolean
  onRequestProductSearchFocus?: () => void
}

export function CartPanel({
  onPay,
  payBlockedReason,
  shortcutsDisabled = false,
  onRequestProductSearchFocus,
}: CartPanelProps) {
  const navigate = useNavigate()
  const items = useCartStore((s) => s.items)
  const removeItem = useCartStore((s) => s.removeItem)
  const getCartTotals = useCartStore((s) => s.getCartTotals)
  const heldCarts = useCartStore((s) => s.heldCarts)
  const holdCart = useCartStore((s) => s.holdCart)
  const recallCart = useCartStore((s) => s.recallCart)
  const removeHeldCart = useCartStore((s) => s.removeHeldCart)

  const [holdDialogOpen, setHoldDialogOpen] = useState(false)
  const [recallDialogOpen, setRecallDialogOpen] = useState(false)
  const [discountDialogOpen, setDiscountDialogOpen] = useState(false)
  const [cashFlowOpen, setCashFlowOpen] = useState(false)
  const [editItem, setEditItem] = useState<CartItem | null>(null)
  const itemDiscounts = useCartStore((s) => s.itemDiscounts)
  const activeShift = useShiftStore((s) => s.activeShift)

  const { total, subtotal, totalDiscount } = getCartTotals()
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)

  const closeEditDialog = useCallback(() => {
    setEditItem(null)
    onRequestProductSearchFocus?.()
  }, [onRequestProductSearchFocus])

  // The name the store falls back to when the field is left empty — shown as
  // the placeholder so the cashier knows what the held cart will be called.
  // Taken when the dialog opens: derived live, it would tick to the next
  // number on screen while the dialog animates out after a hold.
  const [autoHoldLabel, setAutoHoldLabel] = useState("")

  const openHoldDialog = useCallback(() => {
    setAutoHoldLabel(`Pelanggan ${useCartStore.getState().heldCarts.length + 1}`)
    setHoldDialogOpen(true)
  }, [])

  const handleHold = () => {
    if (items.length === 0) return
    openHoldDialog()
  }

  const confirmHold = (typedLabel: string) => {
    // A second Enter while the dialog animates out would otherwise toast a
    // hold that never happened: the cart is already empty by then.
    if (items.length === 0) return
    const label = typedLabel || autoHoldLabel
    holdCart(label)
    setHoldDialogOpen(false)
    toast.success(id.cashier.cartHeld(label))
    onRequestProductSearchFocus?.()
  }

  const handleRecall = useCallback(
    (holdId: string) => {
      const { heldCarts: held, items: current } = useCartStore.getState()
      const label =
        held.find((cart) => cart.id === holdId)?.label ?? id.cashier.heldCartFallbackLabel
      // Recalling over a non-empty cart parks that cart as "Keranjang Aktif"
      // (see `recallCart`); say so, or it looks like it vanished.
      const parkedCurrent = current.length > 0
      recallCart(holdId)
      setRecallDialogOpen(false)
      toast.success(id.cashier.cartRecalled(label, parkedCurrent))
      onRequestProductSearchFocus?.()
    },
    [recallCart, onRequestProductSearchFocus],
  )

  const handleRemoveHeld = useCallback(
    (holdId: string) => {
      const label = useCartStore.getState().heldCarts.find((cart) => cart.id === holdId)?.label
      removeHeldCart(holdId)
      toast.success(id.cashier.heldCartDeleted(label))
    },
    [removeHeldCart],
  )

  // F1 = cash flow, F2 = discount, F3 = hold, F6 = close shift, F9 = recall, F10 = edit last item
  const anyDialogOpen =
    holdDialogOpen || recallDialogOpen || discountDialogOpen || cashFlowOpen || !!editItem
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Dialog pembayaran / struk sukses milik CashierPage: F3 di sana akan
      // menyimpan keranjang yang sudah dibayar, F9 menukar keranjang di tengah
      // pembayaran.
      if (shortcutsDisabled) return

      if (e.key === "F10") {
        e.preventDefault()
        if (editItem) {
          closeEditDialog()
          return
        }
        if (!anyDialogOpen && items.length > 0) {
          setEditItem(items[0])
        }
        return
      }

      if (anyDialogOpen) return
      if (e.key === "F1" && activeShift) {
        e.preventDefault()
        setCashFlowOpen(true)
      }
      if (e.key === "F2" && items.length > 0) {
        e.preventDefault()
        setDiscountDialogOpen(true)
      }
      if (e.key === "F3" && items.length > 0) {
        e.preventDefault()
        openHoldDialog()
      }
      if (e.key === "F6" && activeShift) {
        e.preventDefault()
        navigate("/close-shift")
      }
      if (e.key === "F9" && heldCarts.length > 0) {
        e.preventDefault()
        setRecallDialogOpen(true)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    items,
    heldCarts.length,
    anyDialogOpen,
    shortcutsDisabled,
    activeShift,
    navigate,
    editItem,
    closeEditDialog,
    openHoldDialog,
  ])

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <h2 className="text-base font-medium">Keranjang</h2>
        {/* Teks, bukan lencana: jumlah item bukan status — DESIGN.md §9. */}
        {items.length > 0 && (
          <span className="text-sm tabular-nums text-muted">{formatNumber(itemCount)} item</span>
        )}
        <div className="flex-1" />
        <Badge.Anchor>
          <Button
            isDisabled={heldCarts.length === 0}
            size="sm"
            variant="tertiary"
            onPress={() => setRecallDialogOpen(true)}
          >
            <PlayCircle />
            Tersimpan
            {/* The badge is drawn outside the button, so its number is not
                part of the button's name; this says it to a screen reader. */}
            {heldCarts.length > 0 && (
              <span className="sr-only">({heldCarts.length} transaksi)</span>
            )}
            <ShortcutKey>F9</ShortcutKey>
          </Button>
          {/* Accent, not danger: a waiting cart is a count, not an error. */}
          {heldCarts.length > 0 && (
            <Badge aria-hidden="true" color="accent" size="sm">
              {heldCarts.length}
            </Badge>
          )}
        </Badge.Anchor>
      </div>

      {/* Cart Items. The column header row is the divider under the title,
          and it stays put on an empty cart so the panel does not reshape
          itself between the first scan and the last. */}
      <ScrollShadow className="min-h-0 flex-1">
        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="Isi keranjang">
              {/* Pita selebar panel, bukan pil: kartunya tanpa padding samping,
                  jadi sudut pil HeroUI menempel di garis tepi kartu dan
                  terlihat terpotong. Garis pemisah sebelum kolom aksi (tanpa
                  judul) juga dibuang — ia memisahkan dari ruang kosong. */}
              <Table.Header>
                <Table.Column isRowHeader className="rounded-none!" id="product">
                  Produk
                </Table.Column>
                <Table.Column className="w-24 rounded-none! text-right after:hidden" id="subtotal">
                  Subtotal
                </Table.Column>
                <Table.Column className="w-9 rounded-none! ps-0" id="actions">
                  <span className="sr-only">Aksi</span>
                </Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <NoData icon={<ShoppingCart />} title="Keranjang Kosong">
                    Scan barcode atau cari produk di panel sebelah.
                  </NoData>
                )}
              >
                {items.map((item) => (
                  <CartItemRow
                    key={item.cart_id}
                    item={item}
                    onRemove={removeItem}
                    onEdit={(it) => setEditItem(it)}
                    hasDiscount={!!itemDiscounts[item.cart_id]}
                  />
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </ScrollShadow>

      <Separator />
      <CartFooter
        total={total}
        subtotal={subtotal}
        totalDiscount={totalDiscount}
        hasItems={items.length > 0}
        hasShift={!!activeShift}
        payBlockedReason={payBlockedReason}
        onDiscount={() => setDiscountDialogOpen(true)}
        onHold={handleHold}
        onCashFlow={() => setCashFlowOpen(true)}
        onCloseShift={() => navigate("/close-shift")}
        onPay={onPay}
      />

      <HoldCartDialog
        open={holdDialogOpen}
        onOpenChange={(open) => {
          setHoldDialogOpen(open)
          if (!open) onRequestProductSearchFocus?.()
        }}
        defaultLabel={autoHoldLabel}
        onHold={confirmHold}
      />

      <HeldCartsDialog
        open={recallDialogOpen}
        onOpenChange={setRecallDialogOpen}
        heldCarts={heldCarts}
        onRecall={handleRecall}
        onRemove={handleRemoveHeld}
      />

      {/* Discount Dialog */}
      <DiscountDialog open={discountDialogOpen} onOpenChange={setDiscountDialogOpen} />

      {/* Cart Item Edit Dialog */}
      <CartItemEditDialog
        open={!!editItem}
        onOpenChange={(open) => {
          if (!open) closeEditDialog()
        }}
        item={editItem}
      />

      {/* Cash Flow Dialog */}
      <CashFlowDialog open={cashFlowOpen} onOpenChange={setCashFlowOpen} />
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Badge,
  Button,
  Input,
  Label,
  Modal,
  ScrollShadow,
  Separator,
  Table,
  TextField,
} from "@heroui/react"
import {
  ArrowDownUp,
  DoorClosed,
  PauseCircle,
  Percent,
  PlayCircle,
  ShoppingCart,
  Trash2,
} from "lucide-react"

import { StatusBadge } from "@/components/status-badge"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { useCartStore } from "../hooks/use-cart-store"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { CartItemRow } from "./cart-item-row"
import { CartItemEditDialog } from "./cart-item-edit-dialog"
import { DiscountDialog } from "./discount-dialog"
import { CashFlowDialog } from "@/features/shift/components/cash-flow-dialog"
import { formatRupiah } from "../utils"
import type { CartItem } from "../types"

interface CartPanelProps {
  onPay: () => void
  disabled?: boolean
  /** Matikan shortcut saat dialog milik CashierPage sedang terbuka */
  shortcutsDisabled?: boolean
  onRequestProductSearchFocus?: () => void
}

function formatHeldDate(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function CartPanel({
  onPay,
  disabled,
  shortcutsDisabled = false,
  onRequestProductSearchFocus,
}: CartPanelProps) {
  const navigate = useNavigate()
  const items = useCartStore((s) => s.items)
  const removeItem = useCartStore((s) => s.removeItem)
  const getTotal = useCartStore((s) => s.getTotal)
  const getSubtotal = useCartStore((s) => s.getSubtotal)
  const getTotalDiscount = useCartStore((s) => s.getTotalDiscount)
  const heldCarts = useCartStore((s) => s.heldCarts)
  const holdCart = useCartStore((s) => s.holdCart)
  const recallCart = useCartStore((s) => s.recallCart)
  const removeHeldCart = useCartStore((s) => s.removeHeldCart)

  const [holdDialogOpen, setHoldDialogOpen] = useState(false)
  const [recallDialogOpen, setRecallDialogOpen] = useState(false)
  const [discountDialogOpen, setDiscountDialogOpen] = useState(false)
  const [cashFlowOpen, setCashFlowOpen] = useState(false)
  const [editItem, setEditItem] = useState<CartItem | null>(null)
  const [holdLabel, setHoldLabel] = useState("")
  const [selectedIdx, setSelectedIdx] = useState(0)
  const selectedRowRef = useRef<HTMLTableRowElement>(null)
  const itemDiscounts = useCartStore((s) => s.itemDiscounts)
  const activeShift = useShiftStore((s) => s.activeShift)

  // Scroll selected row into view when navigating with keyboard
  useEffect(() => {
    if (recallDialogOpen) {
      selectedRowRef.current?.scrollIntoView({ block: "nearest" })
    }
  }, [selectedIdx, recallDialogOpen])

  const total = getTotal()
  const subtotal = getSubtotal()
  const totalDiscount = getTotalDiscount()
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)

  const closeEditDialog = useCallback(() => {
    setEditItem(null)
    onRequestProductSearchFocus?.()
  }, [onRequestProductSearchFocus])

  const handleHold = () => {
    if (items.length === 0) return
    setHoldLabel("")
    setHoldDialogOpen(true)
  }

  const confirmHold = () => {
    holdCart(holdLabel)
    setHoldDialogOpen(false)
    toast.success(`Transaksi disimpan${holdLabel.trim() ? ` — ${holdLabel.trim()}` : ""}`)
  }

  const handleRecall = useCallback(
    (holdId: string) => {
      recallCart(holdId)
      setRecallDialogOpen(false)
      toast.success("Transaksi dilanjutkan")
    },
    [recallCart],
  )

  /**
   * Tombol angka, panah, Enter dan Delete milik dialog transaksi tersimpan,
   * bukan milik tabelnya.
   *
   * `Table` HeroUI adalah grid React Aria: begitu grid itu dapat fokus, panah
   * atas/bawah memindahkan baris fokusnya sendiri dan angka masuk ke typeahead —
   * dua model navigasi yang berebut satu sorotan. Listener ini dipasang di
   * `window` pada fase *capture*, jadi ia berjalan sebelum React sempat
   * meneruskan tombolnya ke grid, dan `stopPropagation` hanya dilakukan untuk
   * tombol yang memang ditangani di sini — Escape dan Tab lewat apa adanya.
   */
  useEffect(() => {
    if (!recallDialogOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const claim = () => {
        e.preventDefault()
        e.stopPropagation()
      }

      const num = parseInt(e.key)
      if (num >= 1 && num <= heldCarts.length) {
        claim()
        handleRecall(heldCarts[num - 1].id)
        return
      }
      if (e.key === "ArrowDown") {
        claim()
        setSelectedIdx((prev) => Math.min(prev + 1, heldCarts.length - 1))
      } else if (e.key === "ArrowUp") {
        claim()
        setSelectedIdx((prev) => Math.max(prev - 1, 0))
      } else if (e.key === "Enter") {
        claim()
        handleRecall(heldCarts[selectedIdx].id)
      } else if (e.key === "Delete") {
        claim()
        removeHeldCart(heldCarts[selectedIdx].id)
        if (heldCarts.length <= 1) {
          setRecallDialogOpen(false)
        } else {
          setSelectedIdx((prev) => Math.min(prev, heldCarts.length - 2))
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [recallDialogOpen, heldCarts, selectedIdx, handleRecall, removeHeldCart])

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
        setHoldLabel("")
        setHoldDialogOpen(true)
      }
      if (e.key === "F6" && activeShift) {
        e.preventDefault()
        navigate("/close-shift")
      }
      if (e.key === "F9" && heldCarts.length > 0) {
        e.preventDefault()
        setSelectedIdx(0)
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
  ])

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <ShoppingCart className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Keranjang</h2>
        {items.length > 0 && (
          <StatusBadge size="sm" status="neutral">
            {itemCount} item
          </StatusBadge>
        )}
        <div className="flex-1" />
        <Badge.Anchor>
          <Button
            isDisabled={heldCarts.length === 0}
            size="sm"
            variant="outline"
            onPress={() => {
              setSelectedIdx(0)
              setRecallDialogOpen(true)
            }}
          >
            <PlayCircle className="mr-1 h-4 w-4" />
            Tersimpan
          </Button>
          {heldCarts.length > 0 && (
            <Badge color="danger" size="sm">
              {heldCarts.length}
            </Badge>
          )}
        </Badge.Anchor>
      </div>

      <Separator />

      {/* Cart Items */}
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <ShoppingCart className="h-10 w-10 text-muted" />
          <p className="font-medium">Keranjang Kosong</p>
          <p className="text-sm text-muted">
            Scan barcode atau cari produk untuk menambahkan ke keranjang
          </p>
        </div>
      ) : (
        <ScrollShadow className="min-h-0 flex-1">
          <Table variant="secondary">
            <Table.Content aria-label="Isi keranjang">
              <Table.Header>
                <Table.Column isRowHeader id="product">
                  Produk
                </Table.Column>
                <Table.Column className="w-[90px] text-right" id="subtotal">
                  Subtotal
                </Table.Column>
                <Table.Column className="w-[36px]" id="actions">
                  <span className="sr-only">Aksi</span>
                </Table.Column>
              </Table.Header>
              <Table.Body>
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
          </Table>
        </ScrollShadow>
      )}

      {/* Footer */}
      <Separator />
      <div className="bg-surface p-4">
        <div className="mb-3 space-y-1">
          {totalDiscount > 0 && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Subtotal</span>
                <span className="tabular-nums">{formatRupiah(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-danger">
                <span>Diskon</span>
                <span className="tabular-nums">-{formatRupiah(totalDiscount)}</span>
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <span className="text-2xl font-semibold">Total</span>
            <span className="text-4xl font-bold leading-none tabular-nums md:text-5xl">
              {formatRupiah(total)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap-reverse gap-2">
          <div className="grid min-w-0 flex-1 basis-40 grid-cols-2 gap-1.5">
            <Button
              className="h-9 px-2 text-xs"
              isDisabled={items.length === 0}
              variant="outline"
              onPress={() => setDiscountDialogOpen(true)}
            >
              <Percent className="mr-1 h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Diskon</span>
              {totalDiscount > 0 && (
                <StatusBadge className="ml-1" size="sm" status="error">
                  -{formatRupiah(totalDiscount)}
                </StatusBadge>
              )}
            </Button>
            <Button
              className="h-9 px-2 text-xs"
              isDisabled={items.length === 0}
              variant="outline"
              onPress={handleHold}
            >
              <PauseCircle className="mr-1 h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Simpan</span>
            </Button>
            {activeShift && (
              <>
                <Button
                  className="h-9 px-2 text-xs"
                  variant="outline"
                  onPress={() => setCashFlowOpen(true)}
                >
                  <ArrowDownUp className="mr-1 h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Uang</span>
                </Button>
                <Button
                  className="h-9 px-2 text-xs text-danger"
                  variant="outline"
                  onPress={() => navigate("/close-shift")}
                >
                  <DoorClosed className="mr-1 h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Tutup</span>
                </Button>
              </>
            )}
          </div>
          <Button
            className="h-auto min-h-[4.5rem] flex-1 basis-20 bg-success text-lg font-semibold text-success-foreground hover:bg-success-hover"
            isDisabled={items.length === 0 || disabled}
            size="lg"
            onPress={onPay}
          >
            Bayar
          </Button>
        </div>
        {items.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            Shortcut cepat: F1 uang, F2 diskon, F3 simpan, F4 bayar, F9 transaksi tersimpan.
          </p>
        )}
      </div>

      {/* Hold Dialog */}
      <Modal.Backdrop isOpen={holdDialogOpen} onOpenChange={setHoldDialogOpen}>
        <Modal.Container size="sm">
          <Modal.Dialog aria-label="Simpan Transaksi">
            <Modal.Header>
              <Modal.Heading>Simpan Transaksi</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="space-y-3">
              <p className="text-sm text-muted">
                Beri label agar mudah dikenali (opsional), lalu tekan Enter
              </p>
              <TextField autoFocus fullWidth value={holdLabel} onChange={setHoldLabel}>
                <Label className="sr-only">Label transaksi</Label>
                <Input
                  placeholder="Contoh: Pelanggan 1"
                  onKeyDown={(e) => e.key === "Enter" && confirmHold()}
                />
              </TextField>
              <p className="text-sm text-muted">
                {itemCount} item • {formatRupiah(total)}
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button className="w-full" onPress={confirmHold}>
                <PauseCircle className="mr-2 h-4 w-4" />
                Simpan Transaksi
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* Recall Dialog — Wide table view */}
      <Modal.Backdrop isOpen={recallDialogOpen} onOpenChange={setRecallDialogOpen}>
        <Modal.Container size="lg">
          <Modal.Dialog aria-label="Transaksi Tersimpan">
            <Modal.Header>
              <Modal.Heading>Transaksi Tersimpan ({heldCarts.length})</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="space-y-3">
              <p className="text-sm text-muted">
                ↑↓ pilih • Enter lanjut • Del hapus • Angka 1-
                {Math.min(heldCarts.length, 9)} panggil cepat
              </p>
              <ScrollShadow className="max-h-[500px]">
                <Table variant="secondary">
                  <Table.Content aria-label="Daftar transaksi tersimpan">
                    <Table.Header>
                      <Table.Column className="w-[40px] text-center" id="index">
                        #
                      </Table.Column>
                      <Table.Column className="w-[130px]" id="date">
                        Tanggal
                      </Table.Column>
                      <Table.Column className="w-[130px]" isRowHeader id="label">
                        Label
                      </Table.Column>
                      <Table.Column id="items">Barang (Jumlah)</Table.Column>
                      <Table.Column className="w-[110px] text-right" id="total">
                        Total
                      </Table.Column>
                      <Table.Column className="w-[170px] text-center" id="actions">
                        Aksi
                      </Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {heldCarts.map((held, idx) => (
                        <Table.Row
                          key={held.id}
                          id={held.id}
                          ref={idx === selectedIdx ? selectedRowRef : undefined}
                          className={cn("align-top", idx === selectedIdx && "bg-default")}
                          textValue={held.label}
                        >
                          <Table.Cell className="text-center font-semibold">{idx + 1}</Table.Cell>
                          <Table.Cell className="whitespace-nowrap text-sm">
                            {formatHeldDate(held.heldAt)}
                          </Table.Cell>
                          <Table.Cell className="font-medium">{held.label}</Table.Cell>
                          <Table.Cell className="text-sm">
                            {held.items.map((item) => (
                              <div key={item.cart_id} className="leading-snug">
                                {item.product_name} ({item.quantity})
                              </div>
                            ))}
                          </Table.Cell>
                          <Table.Cell className="text-right font-semibold tabular-nums">
                            {formatRupiah(held.total)}
                          </Table.Cell>
                          <Table.Cell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                className="h-7 text-xs"
                                size="sm"
                                onPress={() => handleRecall(held.id)}
                              >
                                <PlayCircle className="mr-1 h-3.5 w-3.5" />
                                Lanjut
                              </Button>
                              <Button
                                className="h-7 text-xs"
                                size="sm"
                                variant="danger"
                                onPress={() => {
                                  removeHeldCart(held.id)
                                  if (heldCarts.length <= 1) setRecallDialogOpen(false)
                                }}
                              >
                                <Trash2 className="mr-1 h-3.5 w-3.5" />
                                Hapus
                              </Button>
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table>
              </ScrollShadow>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

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

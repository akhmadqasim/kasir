import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowDownUp,
  DoorClosed,
  PauseCircle,
  Percent,
  PlayCircle,
  ShoppingCart,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
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
}

function formatHeldDate(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function CartPanel({ onPay, disabled }: CartPanelProps) {
  const navigate = useNavigate()
  const items = useCartStore((s) => s.items)
  const updateQuantity = useCartStore((s) => s.updateQuantity)
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

  const handleRecall = (holdId: string) => {
    recallCart(holdId)
    setRecallDialogOpen(false)
    toast.success("Transaksi dilanjutkan")
  }

  // F2 = discount, F3 = hold, F6 = close shift, F9 = recall, F10 = cash flow
  const anyDialogOpen = holdDialogOpen || recallDialogOpen || discountDialogOpen || cashFlowOpen || !!editItem
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (anyDialogOpen) return
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
      if (e.key === "F10" && activeShift) {
        e.preventDefault()
        setCashFlowOpen(true)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [items.length, heldCarts.length, anyDialogOpen, activeShift])

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <ShoppingCart className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Keranjang</h2>
        {items.length > 0 && (
          <Badge variant="secondary">{itemCount} item</Badge>
        )}
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="relative"
          onClick={() => { setSelectedIdx(0); setRecallDialogOpen(true) }}
          disabled={heldCarts.length === 0}
        >
          <PlayCircle className="mr-1 h-4 w-4" />
          Tersimpan (F9)
          {heldCarts.length > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-2 -top-2 h-5 w-5 p-0 text-xs flex items-center justify-center"
            >
              {heldCarts.length}
            </Badge>
          )}
        </Button>
      </div>

      <Separator />

      {/* Cart Items */}
      {items.length === 0 ? (
        <Empty className="flex-1 border-none">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShoppingCart />
            </EmptyMedia>
            <EmptyTitle>Keranjang Kosong</EmptyTitle>
            <EmptyDescription>
              Scan barcode atau cari produk untuk menambahkan ke keranjang
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead className="w-[100px] text-center">Qty</TableHead>
                <TableHead className="w-[90px] text-right">Subtotal</TableHead>
                <TableHead className="w-[36px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <CartItemRow
                  key={item.cart_id}
                  item={item}
                  onUpdateQuantity={updateQuantity}
                  onRemove={removeItem}
                  onEdit={(it) => setEditItem(it)}
                  hasDiscount={!!itemDiscounts[item.cart_id]}
                />
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}

      {/* Footer */}
      <Separator />
      <div className="bg-card p-4">
        <div className="mb-3 space-y-1">
          {totalDiscount > 0 && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatRupiah(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-destructive">
                <span>Diskon</span>
                <span className="tabular-nums">-{formatRupiah(totalDiscount)}</span>
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xl font-semibold">Total</span>
            <span className="text-3xl font-bold tabular-nums">
              {formatRupiah(total)}
            </span>
          </div>
        </div>
        <Button
          className="h-12 w-full text-lg font-semibold"
          size="lg"
          disabled={items.length === 0 || disabled}
          onClick={onPay}
        >
          Bayar (F4)
        </Button>
        <div className="mt-2 flex gap-1.5">
          <Button
            variant="outline"
            className="h-9 flex-1 px-2 text-xs"
            disabled={items.length === 0}
            onClick={() => setDiscountDialogOpen(true)}
          >
            <Percent className="mr-1 h-3.5 w-3.5" />
            Diskon F2
            {totalDiscount > 0 && (
              <Badge variant="destructive" className="ml-1 text-[10px] px-1 py-0">
                -{formatRupiah(totalDiscount)}
              </Badge>
            )}
          </Button>
          <Button
            variant="outline"
            className="h-9 flex-1 px-2 text-xs"
            disabled={items.length === 0}
            onClick={handleHold}
          >
            <PauseCircle className="mr-1 h-3.5 w-3.5" />
            Simpan F3
          </Button>
          {activeShift && (
            <>
              <Button
                variant="outline"
                className="h-9 flex-1 px-2 text-xs"
                onClick={() => setCashFlowOpen(true)}
              >
                <ArrowDownUp className="mr-1 h-3.5 w-3.5" />
                Uang F10
              </Button>
              <Button
                variant="outline"
                className="h-9 flex-1 px-2 text-xs text-destructive hover:text-destructive"
                onClick={() => navigate("/close-shift")}
              >
                <DoorClosed className="mr-1 h-3.5 w-3.5" />
                Tutup F6
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Hold Dialog */}
      <Dialog open={holdDialogOpen} onOpenChange={setHoldDialogOpen}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Simpan Transaksi</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Beri label agar mudah dikenali (opsional), lalu tekan Enter
            </p>
            <Input
              placeholder="Contoh: Pelanggan 1"
              value={holdLabel}
              onChange={(e) => setHoldLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmHold()}
              autoFocus
            />
            <p className="text-sm text-muted-foreground">
              {itemCount} item • {formatRupiah(total)}
            </p>
            <Button className="w-full" onClick={confirmHold}>
              <PauseCircle className="mr-2 h-4 w-4" />
              Simpan Transaksi
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Recall Dialog — Wide table view */}
      <Dialog open={recallDialogOpen} onOpenChange={setRecallDialogOpen}>
        <DialogContent
          className="sm:max-w-3xl"
          aria-describedby={undefined}
          onKeyDown={(e) => {
            const num = parseInt(e.key)
            if (num >= 1 && num <= heldCarts.length) {
              e.preventDefault()
              handleRecall(heldCarts[num - 1].id)
              return
            }
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setSelectedIdx((prev) => Math.min(prev + 1, heldCarts.length - 1))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setSelectedIdx((prev) => Math.max(prev - 1, 0))
            } else if (e.key === "Enter") {
              e.preventDefault()
              handleRecall(heldCarts[selectedIdx].id)
            } else if (e.key === "Delete") {
              e.preventDefault()
              removeHeldCart(heldCarts[selectedIdx].id)
              if (heldCarts.length <= 1) {
                setRecallDialogOpen(false)
              } else {
                setSelectedIdx((prev) => Math.min(prev, heldCarts.length - 2))
              }
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Transaksi Tersimpan ({heldCarts.length})</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            ↑↓ pilih • Enter lanjut • Del hapus • Angka 1-{Math.min(heldCarts.length, 9)} panggil cepat
          </p>
          <ScrollArea className="max-h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px] text-center">#</TableHead>
                  <TableHead className="w-[130px]">Tanggal</TableHead>
                  <TableHead className="w-[130px]">Label</TableHead>
                  <TableHead>Barang (Jumlah)</TableHead>
                  <TableHead className="w-[110px] text-right">Total</TableHead>
                  <TableHead className="w-[170px] text-center">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {heldCarts.map((held, idx) => (
                  <TableRow key={held.id} ref={idx === selectedIdx ? selectedRowRef : undefined} className={cn("align-top", idx === selectedIdx && "bg-muted")}>
                    <TableCell className="text-center font-semibold">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatHeldDate(held.heldAt)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {held.label}
                    </TableCell>
                    <TableCell className="text-sm">
                      {held.items.map((item) => (
                        <div key={item.cart_id} className="leading-snug">
                          {item.product_name} ({item.quantity})
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatRupiah(held.total)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleRecall(held.id)}
                        >
                          <PlayCircle className="mr-1 h-3.5 w-3.5" />
                          Lanjut
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            removeHeldCart(held.id)
                            if (heldCarts.length <= 1) setRecallDialogOpen(false)
                          }}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Hapus
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Discount Dialog */}
      <DiscountDialog
        open={discountDialogOpen}
        onOpenChange={setDiscountDialogOpen}
      />

      {/* Cart Item Edit Dialog */}
      <CartItemEditDialog
        open={!!editItem}
        onOpenChange={(open) => { if (!open) setEditItem(null) }}
        item={editItem}
      />

      {/* Cash Flow Dialog */}
      <CashFlowDialog
        open={cashFlowOpen}
        onOpenChange={setCashFlowOpen}
      />
    </div>
  )
}

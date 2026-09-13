import { useState, type KeyboardEvent } from "react"
import { Button, Description, Label, ListBox, Modal } from "@heroui/react"
import { PlayCircle, Trash2 } from "lucide-react"

import { formatDateTime } from "@/lib/format"
import type { HeldCart } from "@/stores/cart-store"
import { formatRupiah } from "../utils"

interface HeldCartsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  heldCarts: HeldCart[]
  onRecall: (holdId: string) => void
  onRemove: (holdId: string) => void
}

/** Berapa nama barang yang disebut di baris keterangan sebelum "+N lainnya". */
const NAMES_SHOWN = 2

function describeHeldCart(held: HeldCart): string {
  const itemCount = held.items.reduce((sum, item) => sum + item.quantity, 0)
  const names = held.items.slice(0, NAMES_SHOWN).map((item) => item.product_name)
  const rest = held.items.length - names.length
  const summary = rest > 0 ? `${names.join(", ")}, +${rest} lainnya` : names.join(", ")
  return `${formatDateTime(new Date(held.heldAt).toISOString())} · ${itemCount} item · ${summary}`
}

/**
 * Daftar keranjang yang disimpan (F9), dipanggil kembali dengan Enter.
 *
 * Satu `ListBox` — panah, Enter, dan fokusnya milik React Aria, jadi tidak ada
 * lagi listener `window` yang dipasang ulang tiap kali sorotan berpindah, dan
 * sorotan yang berpindah hanya merender daftar ini, bukan seluruh panel
 * keranjang. Yang ditangani sendiri hanya dua tombol yang tidak dikenal
 * listbox: angka 1–9 memanggil langsung, Delete menghapus yang disorot.
 *
 * `selectionBehavior="replace"` membuat panah ikut memindahkan pilihan,
 * sehingga "yang disorot" adalah satu kunci yang bisa dibaca tombol Hapus dan
 * Lanjutkan di footer; Enter di daftar sudah memanggil `onAction`.
 */
export function HeldCartsDialog({
  open,
  onOpenChange,
  heldCarts,
  onRecall,
  onRemove,
}: HeldCartsDialogProps) {
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container size="md">
        <Modal.Dialog aria-label="Transaksi Tersimpan">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Transaksi Tersimpan</Modal.Heading>
          </Modal.Header>
          {/* Isi dialog dilepas saat tertutup, jadi sorotan kembali ke baris
              pertama setiap kali dibuka tanpa efek reset. */}
          <HeldCartsList
            heldCarts={heldCarts}
            onRecall={onRecall}
            onRemove={(holdId) => {
              onRemove(holdId)
              if (heldCarts.length <= 1) onOpenChange(false)
            }}
          />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function HeldCartsList({
  heldCarts,
  onRecall,
  onRemove,
}: Pick<HeldCartsDialogProps, "heldCarts" | "onRecall" | "onRemove">) {
  const [pickedId, setPickedId] = useState<string | null>(null)
  // Turunan, bukan state tersinkron: keranjang yang baru dihapus tidak bisa
  // tetap tersorot, dan sebelum ada yang dipilih sorotan ada di baris pertama.
  const highlightedId = heldCarts.some((held) => held.id === pickedId)
    ? pickedId
    : (heldCarts[0]?.id ?? null)

  const removeHighlighted = () => {
    if (highlightedId) onRemove(highlightedId)
  }

  // Fase capture supaya angka tidak sempat menjadi typeahead listbox.
  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = Number(event.key)
    if (index >= 1 && index <= heldCarts.length) {
      event.preventDefault()
      event.stopPropagation()
      onRecall(heldCarts[index - 1].id)
      return
    }
    if (event.key === "Delete") {
      event.preventDefault()
      event.stopPropagation()
      removeHighlighted()
    }
  }

  return (
    <>
      <Modal.Body>
        <p>Panah memilih, Enter melanjutkan, Delete menghapus, angka 1–9 memanggil langsung.</p>
        <div onKeyDownCapture={handleKeyDownCapture}>
          <ListBox
            aria-label="Daftar transaksi tersimpan"
            autoFocus="first"
            disallowEmptySelection
            selectedKeys={highlightedId ? new Set([highlightedId]) : new Set()}
            selectionBehavior="replace"
            selectionMode="single"
            onAction={(key) => onRecall(String(key))}
            onSelectionChange={(keys) => {
              const [next] = [...keys]
              if (typeof next === "string") setPickedId(next)
            }}
          >
            {heldCarts.map((held, index) => (
              <ListBox.Item
                key={held.id}
                id={held.id}
                // Bawaan HeroUI tidak mewarnai baris terpilih; di sini pilihan
                // adalah sorotan yang digerakkan panah, jadi harus terlihat.
                className="data-[selected=true]:bg-default"
                textValue={held.label}
              >
                <span className="w-4 text-center text-sm text-muted tabular-nums">{index + 1}</span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-baseline justify-between gap-4">
                    <Label>{held.label}</Label>
                    <span className="text-sm font-medium tabular-nums">
                      {formatRupiah(held.total)}
                    </span>
                  </div>
                  <Description>{describeHeldCart(held)}</Description>
                </div>
              </ListBox.Item>
            ))}
          </ListBox>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button isDisabled={!highlightedId} variant="danger-soft" onPress={removeHighlighted}>
          <Trash2 />
          Hapus
        </Button>
        <Button
          isDisabled={!highlightedId}
          onPress={() => highlightedId && onRecall(highlightedId)}
        >
          <PlayCircle />
          Lanjutkan
        </Button>
      </Modal.Footer>
    </>
  )
}

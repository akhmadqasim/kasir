import { Modal } from "@heroui/react"

import { ProductFormBody } from "./product-form-body"
import type { Product } from "../types"

interface ProductFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  product?: Product | null
  onCreateSuccess?: () => void
}

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  onCreateSuccess,
}: ProductFormDialogProps) {
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container scroll="inside" size="lg">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          {/* React Aria melepas dialognya saat ditutup, bukan menahannya sampai
              animasi keluar selesai, jadi state di bawah selalu lahir kosong.
              Membuka ulang untuk produk lain tidak lagi bisa menampilkan nilai
              produk sebelumnya di atas id yang baru. */}
          <ProductFormBody
            product={product}
            onOpenChange={onOpenChange}
            onCreateSuccess={onCreateSuccess}
          />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

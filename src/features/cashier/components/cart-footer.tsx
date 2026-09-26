import { useId } from "react"
import { Button, Description } from "@heroui/react"
import { ArrowDownUp, DoorClosed, PauseCircle, Percent } from "lucide-react"

import { SummaryList } from "@/components/summary-list"
import { formatRupiah } from "../utils"
import { ShortcutKey } from "./shortcut-key"

interface CartFooterProps {
  total: number
  subtotal: number
  totalDiscount: number
  hasItems: boolean
  /** Shift-bound actions (Uang, Tutup) only exist while a shift is open. */
  hasShift: boolean
  /** Why Bayar cannot be pressed even with items in the cart, or `undefined`. */
  payBlockedReason?: string
  onDiscount: () => void
  onHold: () => void
  onCashFlow: () => void
  onCloseShift: () => void
  onPay: () => void
}

/** The cart's totals and its action buttons, Bayar last. */
export function CartFooter({
  total,
  subtotal,
  totalDiscount,
  hasItems,
  hasShift,
  payBlockedReason,
  onDiscount,
  onHold,
  onCashFlow,
  onCloseShift,
  onPay,
}: CartFooterProps) {
  const payReasonId = useId()

  return (
    <div className="flex flex-col gap-4 p-4">
      {totalDiscount > 0 && (
        <SummaryList
          items={[
            { label: "Subtotal", value: formatRupiah(subtotal) },
            { label: "Diskon", value: `-${formatRupiah(totalDiscount)}`, tone: "danger" },
          ]}
        />
      )}
      {/* Total keranjang dibaca kasir dan pelanggan dari jarak, jadi ia satu
          tingkat di atas angka KPI — DESIGN.md §3.4. */}
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-muted">Total</span>
        <span className="text-3xl font-semibold tracking-tight tabular-nums">
          {formatRupiah(total)}
        </span>
      </div>
      {/* Tombol aksi kecil di kiri, Bayar lebar di kanan: tangan kasir sudah
          ada di sisi kanan setelah mengetik total, dan tombol yang paling
          sering ditekan harus yang paling mudah dijangkau. */}
      {/* `flex-wrap`: pada panel sempit (layar 1280) tiga kolom tidak muat
          dan Bayar tadinya terpotong di tepi kartu; sekarang ia turun ke
          baris sendiri selebar panel, dan di layar lebar tetap di kanan. */}
      <div className="flex flex-wrap items-stretch gap-2">
        <div className="grid grow basis-[15.5rem] grid-cols-2 gap-2">
          <Button
            isDisabled={!hasItems}
            fullWidth
            className="justify-start"
            size="sm"
            variant="tertiary"
            onPress={onDiscount}
          >
            <Percent />
            Diskon
            <ShortcutKey className="ml-auto">F2</ShortcutKey>
          </Button>
          <Button
            isDisabled={!hasItems}
            fullWidth
            className="justify-start"
            size="sm"
            variant="tertiary"
            onPress={onHold}
          >
            <PauseCircle />
            Simpan
            <ShortcutKey className="ml-auto">F3</ShortcutKey>
          </Button>
          {hasShift && (
            <>
              <Button
                fullWidth
                className="justify-start"
                size="sm"
                variant="tertiary"
                onPress={onCashFlow}
              >
                <ArrowDownUp />
                Uang
                <ShortcutKey className="ml-auto">F1</ShortcutKey>
              </Button>
              {/* Hanya membuka halaman tutup kasir; yang merusak dikonfirmasi di sana. */}
              <Button
                fullWidth
                className="justify-start"
                size="sm"
                variant="tertiary"
                onPress={onCloseShift}
              >
                <DoorClosed />
                Tutup
                <ShortcutKey className="ml-auto">F6</ShortcutKey>
              </Button>
            </>
          )}
        </div>
        <Button
          aria-describedby={payBlockedReason ? payReasonId : undefined}
          className="h-auto min-h-12 grow basis-32 text-lg"
          isDisabled={!hasItems || payBlockedReason !== undefined}
          size="lg"
          onPress={onPay}
        >
          Bayar
          {/* `.kbd` memaksa `text-muted`; di atas latar aksen warnanya harus ikut tombolnya. */}
          <ShortcutKey className="text-accent-foreground" variant="light">
            F4
          </ShortcutKey>
        </Button>
      </div>
      {/* Tombol yang mati tanpa alasan terbaca seperti rusak. Teks tetap,
          bukan `Tooltip`: tombol nonaktif tidak menerima hover maupun fokus,
          jadi tooltip-nya tidak akan pernah muncul. */}
      {payBlockedReason && (
        <Description className="text-right" id={payReasonId}>
          {payBlockedReason}
        </Description>
      )}
    </div>
  )
}

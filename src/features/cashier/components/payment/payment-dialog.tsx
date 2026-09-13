import { Label, Modal, TextArea, TextField, ToggleButton } from "@heroui/react"
import { InfoPanel } from "@/components/info-panel"
import { NoData } from "@/components/no-data"
import { PendingButton } from "@/components/pending-button"
import { RupiahField } from "@/components/rupiah-field"
import { SummaryList } from "@/components/summary-list"
import { MAX_PAYMENT_AMOUNT } from "../../payment-behavior"
import { formatRupiah } from "../../utils"
import type { TransactionResult } from "../../types"
import { CashFields } from "./cash-fields"
import { TransferFields } from "./transfer-fields"
import { PAYMENT_METHODS, usePaymentForm } from "./use-payment-form"

interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (result: TransactionResult) => void
}

/**
 * The checkout dialog. The till is a PC with a keyboard, not a touchscreen —
 * amounts are typed (`RupiahField`, format-as-you-type) rather than tapped on
 * an on-screen numpad. State and business rules live in `usePaymentForm`;
 * this component only lays them out.
 */
export function PaymentDialog({ open, onOpenChange, onSuccess }: PaymentDialogProps) {
  const form = usePaymentForm({ open, onOpenChange, onSuccess })

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={form.handleOpenChange}>
      <Modal.Container size="md">
        <Modal.Dialog aria-label="Pembayaran">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Pembayaran</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <InfoPanel className="flex items-start justify-between gap-4">
              <div>
                <p className="text-muted">Total</p>
                {form.totalDiscount > 0 && (
                  <p className="text-muted">Diskon {formatRupiah(form.totalDiscount)}</p>
                )}
              </div>
              <div className="text-right">
                {/* Peran "Total keranjang" — DESIGN.md §3.4 */}
                <p className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                  {formatRupiah(form.total)}
                </p>
                {form.subtotal !== form.total && (
                  <p className="text-muted">Subtotal {formatRupiah(form.subtotal)}</p>
                )}
              </div>
            </InfoPanel>

            <div className="flex flex-col gap-2">
              <p>Metode Pembayaran</p>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_METHODS.map((method) => {
                  const split = form.paymentSplits.find(
                    (current) => current.payment_method === method.value,
                  )
                  if (!split) return null

                  return (
                    // `ToggleButton`, bukan tombol biasa: metode yang tercentang
                    // adalah keadaan, dan `aria-pressed` satu-satunya cara pembaca
                    // layar tahu mana yang aktif. Klik tetap lewat `handleMethodClick`
                    // — aturan radio-lalu-tambah ada di situ.
                    <ToggleButton
                      key={method.value}
                      className="w-full"
                      isSelected={split.selected}
                      onChange={() => form.handleMethodClick(method.value)}
                    >
                      {method.label}
                    </ToggleButton>
                  )
                })}
              </div>
            </div>

            {form.selectedPaymentSplits.length > 0 ? (
              <div className="flex flex-col gap-3">
                {form.selectedPaymentSplits.map((split) => {
                  const label =
                    PAYMENT_METHODS.find((method) => method.value === split.payment_method)
                      ?.label ?? split.payment_method
                  const isCash = split.payment_method === "cash"

                  return (
                    <div key={split.payment_method} className="flex flex-col gap-2">
                      <RupiahField
                        ref={isCash ? form.cashInputRef : undefined}
                        autoFocus={isCash && form.isSingleCashSelection}
                        label={`Nominal ${label}`}
                        placeholder="0"
                        value={split.amount}
                        onChange={(value) => form.handleAmountChange(split.payment_method, value)}
                        onFocus={() => form.setActivePaymentMethod(split.payment_method)}
                        onKeyDown={form.handleAmountKeyDown(split.payment_method, split.amount)}
                      />
                      {split.payment_method === "transfer" && (
                        <TransferFields
                          value={split.bank_name}
                          onChange={(value) =>
                            form.handleBankNameChange(split.payment_method, value)
                          }
                          onFocus={() => form.setActivePaymentMethod(split.payment_method)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <NoData title="Pilih metode pembayaran dulu." />
            )}

            <CashFields
              onQuickAmount={form.handleQuickRoundAmount}
              onRemainingAmount={form.handleSetRemainingAmount}
            />

            {form.isSingleCashSelection && form.primaryPaymentAmount > 0 && (
              <SummaryList
                items={[
                  {
                    label: "Kembalian",
                    value: formatRupiah(Math.max(0, form.changeAmount)),
                    tone: form.changeAmount < 0 ? "danger" : "success",
                  },
                ]}
              />
            )}
            {form.hasImplausibleAmount && (
              <p className="text-danger">
                Nominal pembayaran melebihi {formatRupiah(MAX_PAYMENT_AMOUNT)}. Periksa kembali —
                kemungkinan barcode ikut terbaca.
              </p>
            )}
            {form.selectedMethodCount > 1 &&
              ((!form.hasCashInSplit && Math.abs(form.splitDifference) >= 0.01) ||
                (form.hasCashInSplit &&
                  (form.nonCashSplitAmount > form.total + 0.01 ||
                    form.cashSplitAmount + 0.01 <
                      Math.max(form.total - form.nonCashSplitAmount, 0)))) && (
                <p className="text-danger">
                  {form.hasCashInSplit
                    ? form.nonCashSplitAmount > form.total + 0.01
                      ? "Nominal non-tunai melebihi total transaksi."
                      : `Nominal tunai masih kurang ${formatRupiah(
                          Math.max(
                            form.total - form.nonCashSplitAmount - form.cashSplitAmount,
                            0,
                          ),
                        )}.`
                    : form.splitDifference > 0
                      ? `Nominal gabungan masih kurang ${formatRupiah(form.splitDifference)}.`
                      : `Nominal gabungan kelebihan ${formatRupiah(Math.abs(form.splitDifference))}.`}
                </p>
              )}
            {form.selectedMethodCount > 1 &&
              form.hasCashInSplit &&
              form.nonCashSplitAmount <= form.total + 0.01 &&
              form.cashSplitAmount + 0.01 >= Math.max(form.total - form.nonCashSplitAmount, 0) &&
              form.totalSplitAmount - form.total > 0.01 && (
                <SummaryList
                  items={[
                    {
                      label: "Kembalian tunai",
                      value: formatRupiah(form.totalSplitAmount - form.total),
                      tone: "success",
                    },
                  ]}
                />
              )}
            {!form.allTransferMethodsHaveBank && (
              <p className="text-danger">Isi nama bank untuk pembayaran transfer bank.</p>
            )}

            <TextField fullWidth value={form.notes} variant="secondary" onChange={form.setNotes}>
              <Label>Catatan</Label>
              <TextArea placeholder="Opsional" rows={2} />
            </TextField>
          </Modal.Body>
          <Modal.Footer>
            <PendingButton
              fullWidth
              isDisabled={!form.canConfirm}
              isPending={form.isPending}
              onPress={form.handleConfirm}
            >
              Bayar
            </PendingButton>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

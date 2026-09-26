import { useId } from "react"
import { Input, Label, Modal, TextArea, TextField } from "@heroui/react"
import { id } from "@/i18n/id"
import { InfoPanel } from "@/components/info-panel"
import { NoData } from "@/components/no-data"
import { PendingButton } from "@/components/pending-button"
import { RupiahField } from "@/components/rupiah-field"
import { SummaryList } from "@/components/summary-list"
import { paymentMethodLabel } from "@/lib/labels"
import { MAX_PAYMENT_AMOUNT } from "../../payment-behavior"
import { formatRupiah } from "../../utils"
import type { TransactionResult } from "../../types"
import { CashFields } from "./cash-fields"
import { BankField } from "./bank-field"
import { PaymentMethodPicker } from "./payment-method-picker"
import { PPOB_PIN_FIELD_NAME } from "./payment-methods"
import { usePaymentForm, type DirectSale } from "./use-payment-form"

interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (result: TransactionResult) => void
  /** Charge this instead of the cart — the PPOB page's one line. */
  sale?: DirectSale
}

/**
 * The checkout dialog. The till is a PC with a keyboard, not a touchscreen —
 * amounts are typed (`RupiahField`, format-as-you-type) rather than tapped on
 * an on-screen numpad. State and business rules live in `usePaymentForm`;
 * this component only lays them out.
 */
export function PaymentDialog({ open, onOpenChange, onSuccess, sale }: PaymentDialogProps) {
  const form = usePaymentForm({ open, onOpenChange, onSuccess, sale })
  const quickLabelId = useId()

  return (
    // While the sale is being booked the dialog cannot be closed (see
    // `handleOpenChange`), so the close button, Esc and a click outside are
    // switched off visibly instead of looking live and doing nothing.
    <Modal.Backdrop
      isDismissable={!form.isPending}
      isKeyboardDismissDisabled={form.isPending}
      isOpen={open}
      onOpenChange={form.handleOpenChange}
    >
      {/* Dua sisi: kiri apa yang dibayar dan dengan apa, kanan berapa yang
          diterima — kasir membaca total dan mengetik nominal tanpa menggulir. */}
      <Modal.Container size="lg">
        <Modal.Dialog aria-label="Pembayaran" className="max-w-[44rem]">
          <Modal.CloseTrigger isDisabled={form.isPending} />
          <Modal.Header>
            <Modal.Heading>Pembayaran</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="overflow-visible">
            <div className="grid min-w-0 gap-6 md:grid-cols-2">
              <div className="flex flex-col gap-4">
                <InfoPanel className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-muted">Total</p>
                    {/* Peran "Total keranjang" — DESIGN.md §3.4 */}
                    <p className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                      {formatRupiah(form.total)}
                    </p>
                  </div>
                  {/* Subtotal dan diskon sebagai satu baris kecil di bawah
                      angkanya, dengan tanda minus: "Diskon Rp 5.000" tanpa
                      tanda terbaca seperti biaya tambahan. */}
                  {form.totalDiscount > 0 && (
                    <p className="text-right text-muted tabular-nums">
                      {`Subtotal ${formatRupiah(form.subtotal)} · Diskon -${formatRupiah(form.totalDiscount)}`}
                    </p>
                  )}
                </InfoPanel>

                {form.selectedPaymentSplits.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {form.selectedPaymentSplits.map((split) => {
                      const label = paymentMethodLabel(split.payment_method)
                      const isCash = split.payment_method === "cash"

                      return (
                        <div key={split.payment_method} className="flex flex-col gap-2">
                          <RupiahField
                            ref={form.registerAmountInput(split.payment_method)}
                            autoFocus={isCash && form.isSingleCashSelection}
                            label={`Nominal ${label}`}
                            placeholder="0"
                            value={split.amount}
                            onChange={(value) =>
                              form.handleAmountChange(split.payment_method, value)
                            }
                            onFocus={() => form.setActivePaymentMethod(split.payment_method)}
                            onKeyDown={form.handleAmountKeyDown(split.payment_method, split.amount)}
                          />
                          {!isCash && (
                            <BankField
                              method={split.payment_method}
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
                  <NoData title={id.cashier.choosePaymentMethod} />
                )}

                {/* Uang yang kurang disebut jumlahnya, bukan "Kembalian Rp 0"
                    berwarna merah — kasir perlu tahu berapa lagi yang diminta. */}
                {form.isSingleCashSelection && form.primaryPaymentAmount > 0 && (
                  <SummaryList
                    items={[
                      form.changeAmount < 0
                        ? {
                            label: "Kurang",
                            value: formatRupiah(-form.changeAmount),
                            tone: "danger",
                          }
                        : {
                            label: "Kembalian",
                            value: formatRupiah(form.changeAmount),
                            tone: "success",
                          },
                    ]}
                  />
                )}
                {form.hasImplausibleAmount && (
                  <p className="text-danger" role="alert">
                    Nominal pembayaran melebihi {formatRupiah(MAX_PAYMENT_AMOUNT)}. Periksa kembali
                    — kemungkinan barcode ikut terbaca.
                  </p>
                )}
                {form.splitError && (
                  <p className="text-danger" role="alert">
                    {form.splitError}
                  </p>
                )}
                {form.splitCashChange > 0 && (
                  <SummaryList
                    items={[
                      {
                        label: "Kembalian tunai",
                        value: formatRupiah(form.splitCashChange),
                        tone: "success",
                      },
                    ]}
                  />
                )}

                <TextField
                  fullWidth
                  value={form.notes}
                  variant="secondary"
                  onChange={form.setNotes}
                >
                  <Label>Catatan</Label>
                  <TextArea className="resize-none" placeholder="Opsional" rows={2} />
                </TextField>

                {/* Diminta di sini, saat transaksi dibayar — bukan dibaca
                    diam-diam dari Pengaturan. Hanya muncul kalau keranjang
                    memuat barang PPOB. */}
                {form.hasPpobItems && (
                  <TextField
                    fullWidth
                    value={form.ppobPin}
                    variant="secondary"
                    onChange={form.setPpobPin}
                  >
                    <Label>PIN Mitra</Label>
                    <Input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      maxLength={6}
                      name={PPOB_PIN_FIELD_NAME}
                      placeholder={id.ppobFulfillment.pinPlaceholder}
                      type="password"
                      onKeyDown={form.handlePinKeyDown}
                    />
                  </TextField>
                )}
              </div>

              <div className="flex flex-col gap-4">
                <PaymentMethodPicker
                  paymentSplits={form.paymentSplits}
                  onToggle={form.handleMethodClick}
                />

                <div aria-labelledby={quickLabelId} className="flex flex-col gap-2" role="group">
                  <p className="font-medium text-foreground" id={quickLabelId}>
                    Nominal Cepat
                  </p>
                  <CashFields
                    onQuickAmount={form.handleQuickRoundAmount}
                    onRemainingAmount={form.handleSetRemainingAmount}
                  />
                </div>

                {/* Di dasar kolom kanan, selebar kolomnya dan agak tinggi:
                    tombol terakhir yang ditekan kasir tiap transaksi. */}
                <PendingButton
                  className="mt-auto min-h-12 text-lg"
                  fullWidth
                  isDisabled={!form.canConfirm}
                  isPending={form.isPending}
                  size="lg"
                  onPress={form.handleConfirm}
                >
                  Bayar
                </PendingButton>
              </div>
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

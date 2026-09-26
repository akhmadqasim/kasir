import type { KeyboardEvent } from "react"
import { Card, Input, Label, TextField } from "@heroui/react"

import { CardHeading } from "@/components/card-heading"
import { PendingButton } from "@/components/pending-button"
import { RupiahField } from "@/components/rupiah-field"
import { id } from "@/i18n/id"
import type { PpSubMenuItem } from "../../types"

interface PpCodeStepProps {
  merchant: PpSubMenuItem
  paymentCode: string
  onPaymentCodeChange: (value: string) => void
  amount: number | null
  onAmountChange: (value: number | null) => void
  /** A bill has been looked up: the button goes, and Enter no longer re-checks. */
  hasInquiry: boolean
  canInquiry: boolean
  isInquiring: boolean
  onInquiry: () => void
}

/** Langkah 3 Payment Point: kode pembayaran (dan nominal, bila biller memintanya). */
export function PpCodeStep({
  merchant,
  paymentCode,
  onPaymentCodeChange,
  amount,
  onAmountChange,
  hasInquiry,
  canInquiry,
  isInquiring,
  onInquiry,
}: PpCodeStepProps) {
  const inquireOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !hasInquiry) onInquiry()
  }

  return (
    <Card>
      <Card.Header>
        <CardHeading>{merchant.merchant}</CardHeading>
        {merchant.description && <Card.Description>{merchant.description}</Card.Description>}
      </Card.Header>
      <Card.Content className="gap-4">
        {/* Fokus langsung ke kolom kode: ubin biller yang baru ditekan
            sudah hilang dari layar, dan tanpa ini fokus jatuh ke body. */}
        <TextField
          autoFocus
          fullWidth
          value={paymentCode}
          variant="secondary"
          onChange={onPaymentCodeChange}
        >
          <Label>{merchant.label || id.ppob.paymentCode}</Label>
          <Input
            className="tabular-nums"
            placeholder={id.ppob.paymentCodePlaceholder}
            onKeyDown={inquireOnEnter}
          />
        </TextField>

        {merchant.inputAmt ? (
          <RupiahField
            label={id.ppob.nominal}
            value={amount}
            onChange={onAmountChange}
            onKeyDown={inquireOnEnter}
          />
        ) : null}

        {!hasInquiry && (
          <PendingButton
            fullWidth
            isDisabled={!canInquiry}
            isPending={isInquiring}
            onPress={onInquiry}
          >
            Cek Tagihan
          </PendingButton>
        )}
      </Card.Content>
    </Card>
  )
}

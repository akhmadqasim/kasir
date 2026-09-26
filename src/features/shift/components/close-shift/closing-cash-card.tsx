import { Button, Card, Description, Input, Label, TextField } from "@heroui/react"

import { StatusBadge } from "@/components/status-badge"
import { id } from "@/i18n/id"
import { CardHeading } from "../card-heading"
import { cashDifferenceStatus, cashDifferenceText, groupDigits, toDigits } from "../../utils"

interface ClosingCashCardProps {
  /** The counted drawer as typed: digits only, `""` when empty. */
  closingCash: string
  onClosingCashChange: (digits: string) => void
  notes: string
  onNotesChange: (notes: string) => void
  /** `closingCash - expectedCash`, or `null` without a count. */
  cashDifference: number | null
  isSubmitting: boolean
  /** Opens the confirmation chain; nothing is sent yet. */
  onRequestClose: () => void
}

/** The drawer count and a note, then the button that starts closing the shift. */
export function ClosingCashCard({
  closingCash,
  onClosingCashChange,
  notes,
  onNotesChange,
  cashDifference,
  isSubmitting,
  onRequestClose,
}: ClosingCashCardProps) {
  return (
    <Card>
      <Card.Header>
        <CardHeading>{id.shift.close.title}</CardHeading>
        <Card.Description>{id.shift.close.description}</Card.Description>
      </Card.Header>
      <Card.Content>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <TextField
              autoFocus
              fullWidth
              value={groupDigits(closingCash)}
              variant="secondary"
              onChange={(value) => onClosingCashChange(toDigits(value))}
            >
              <Label>{id.shift.close.closingCash}</Label>
              <Input className="text-right tabular-nums" inputMode="numeric" placeholder="0" />
              <Description>{id.shift.close.closingCashHint}</Description>
            </TextField>
            {cashDifference !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted">{id.shift.close.difference}:</span>
                <StatusBadge className="tabular-nums" status={cashDifferenceStatus(cashDifference)}>
                  {cashDifferenceText(cashDifference)}
                </StatusBadge>
              </div>
            )}
          </div>
          <TextField fullWidth value={notes} variant="secondary" onChange={onNotesChange}>
            <Label>{id.shift.close.notes}</Label>
            <Input placeholder={id.shift.close.notesPlaceholder} />
          </TextField>
        </div>
      </Card.Content>
      <Card.Footer>
        {/* Hanya membuka langkah review — belum ada mutasi, jadi bukan `isPending`. */}
        <Button fullWidth isDisabled={isSubmitting} variant="danger" onPress={onRequestClose}>
          {id.shift.close.submit}
        </Button>
      </Card.Footer>
    </Card>
  )
}

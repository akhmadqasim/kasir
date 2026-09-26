import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { Button, Dropdown, Label } from "@heroui/react"

import { id } from "@/i18n/id"

interface TransactionAdminMenuProps {
  onEditPayment: () => void
  onVoid: () => void
}

/**
 * Admin corrections (void, change payment method). They are rare and one of
 * them is destructive, so they sit in a menu apart from the everyday actions.
 */
export function TransactionAdminMenu({ onEditPayment, onVoid }: TransactionAdminMenuProps) {
  return (
    <Dropdown>
      <Button aria-label="Aksi lainnya" isIconOnly variant="tertiary">
        <MoreHorizontal />
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          onAction={(key) => {
            if (key === "edit-payment") onEditPayment()
            else if (key === "delete") onVoid()
          }}
        >
          <Dropdown.Item id="edit-payment" textValue={id.transactions.editPaymentMethod}>
            <Pencil className="size-4 shrink-0 text-muted" />
            <Label>{id.transactions.editPaymentMethod}</Label>
          </Dropdown.Item>
          <Dropdown.Item id="delete" textValue={id.common.delete} variant="danger">
            <Trash2 className="size-4 shrink-0 text-danger" />
            <Label>{id.common.delete}</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

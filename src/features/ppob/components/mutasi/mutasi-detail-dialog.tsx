import { ArrowDownCircle, ArrowUpCircle } from "lucide-react"
import { Button, Modal, Separator } from "@heroui/react"

import { SummaryList } from "@/components/summary-list"
import { id as i18n } from "@/i18n/id"
import { VendorStatusBadge } from "../history/vendor-status-badge"
import type { MutasiItem } from "../../types"
import { buildMutasiDetailRows } from "./mutasi-detail-rows"
import { formatSignedAmount } from "./mutasi-utils"

/** Satu mutasi lengkap: nominal bertanda, status, dan isi mentah dari vendor. */
export function MutasiDetailDialog({
  item,
  open,
  onOpenChange,
}: {
  item: MutasiItem
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isIn = item.mutationType === "in"
  const detailRows = buildMutasiDetailRows(item.rawData)
  const heading = isIn ? i18n.ppob.mutasiTopup : i18n.ppob.mutasiPayment

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label={heading}>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon
              className={
                isIn
                  ? "bg-success-soft text-success-soft-foreground"
                  : "bg-danger-soft text-danger-soft-foreground"
              }
            >
              {isIn ? <ArrowDownCircle className="size-5" /> : <ArrowUpCircle className="size-5" />}
            </Modal.Icon>
            <Modal.Heading>{heading}</Modal.Heading>
          </Modal.Header>

          <Modal.Body>
            <div className="flex items-center justify-between">
              <span
                className={`text-xl font-semibold tracking-tight tabular-nums ${isIn ? "text-success" : "text-danger"}`}
              >
                {formatSignedAmount(item)}
              </span>
              <VendorStatusBadge status={item.status} />
            </div>

            <Separator />

            {/* The container's default `scroll="inside"` already caps the dialog
                height and scrolls the body, so no scroll box of its own here. */}
            <SummaryList items={detailRows} layout="grid" />
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              {i18n.common.close}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

import { Button, Card, Separator } from "@heroui/react"
import { ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, Trash2 } from "lucide-react"

import { id } from "@/i18n/id"
import { NoData } from "@/components/no-data"
import { SummaryList } from "@/components/summary-list"
import { netCashFlowItem, signedCashFlowAmount, signedRupiah } from "../../utils"
import type { CashFlow, ShiftSummary } from "../../types"
import { CardHeading } from "../card-heading"
import { CashFlowDescription } from "./cash-flow-description"

interface CashFlowsCardProps {
  summary: ShiftSummary
  /** Whether the current user may delete this entry: its author, or an admin. */
  canDelete: (cashFlow: CashFlow) => boolean
  onDelete: (cashFlow: CashFlow) => void
}

/** The shift's manual cash in/out entries, each deletable by whoever may. */
export function CashFlowsCard({ summary, canDelete, onDelete }: CashFlowsCardProps) {
  return (
    <Card>
      <Card.Header>
        <CardHeading>Uang Masuk / Keluar</CardHeading>
      </Card.Header>
      <Card.Content>
        {summary.cashFlows.length > 0 ? (
          <div className="flex flex-col gap-3">
            <ul aria-label="Daftar uang masuk dan keluar" className="flex flex-col gap-2">
              {summary.cashFlows.map((cf) => (
                <li key={cf.id} className="flex min-h-9 items-center gap-2">
                  {/* Arahnya dibawa ikon, tanda +/-, dan teks tersembunyi,
                      bukan warna saja (DESIGN.md §7). */}
                  {cf.flowType === "in" ? (
                    <ArrowDownCircle aria-hidden="true" className="size-4 shrink-0 text-success" />
                  ) : (
                    <ArrowUpCircle aria-hidden="true" className="size-4 shrink-0 text-danger" />
                  )}
                  <span className="sr-only">
                    {cf.flowType === "in" ? id.shift.cashIn : id.shift.cashOut}:
                  </span>
                  <CashFlowDescription description={cf.description} />
                  <span
                    className={`ml-auto shrink-0 text-sm font-medium tabular-nums ${cf.flowType === "in" ? "text-success" : "text-danger"}`}
                  >
                    {signedRupiah(signedCashFlowAmount(cf))}
                  </span>
                  {canDelete(cf) && (
                    <Button
                      aria-label={`Hapus arus kas ${cf.description}`}
                      className="shrink-0"
                      isIconOnly
                      size="sm"
                      variant="danger-soft"
                      onPress={() => onDelete(cf)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <Separator />
            <SummaryList
              items={[
                netCashFlowItem(summary),
                // Retur tunai bukan arus kas manual, tapi sudah dipotong dari
                // saldo tutup kasir. Tanpa barisnya, laci kurang dan tidak ada
                // yang menjelaskan kenapa.
                ...(summary.cashRefunds > 0
                  ? [
                      {
                        label: "Retur tunai",
                        value: signedRupiah(-summary.cashRefunds),
                        tone: "danger" as const,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        ) : (
          <NoData icon={<ArrowLeftRight />} title={id.empty.cashFlows} />
        )}
      </Card.Content>
    </Card>
  )
}

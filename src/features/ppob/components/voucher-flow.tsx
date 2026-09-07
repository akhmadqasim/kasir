import { useNavigate } from "react-router-dom"
import { Button, Card, Skeleton } from "@heroui/react"
import { ArrowLeft, Ticket } from "lucide-react"

import { id } from "@/i18n/id"
import { useVoucherGroups } from "../hooks"

export function VoucherFlow() {
  const navigate = useNavigate()

  const { data: groups, isLoading } = useVoucherGroups()

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button
          aria-label={id.common.back}
          isIconOnly
          variant="tertiary"
          onPress={() => navigate("/ppob")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{id.ppob.voucher}</h1>
          <p className="text-sm text-muted">{id.ppob.voucherProducts}</p>
        </div>
      </div>

      {/* Voucher Group Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : groups && groups.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {groups.map((group) => (
            <Card key={group.id} className="transition-colors hover:bg-default">
              <Card.Content className="flex flex-col items-center gap-2 py-6">
                {group.icon ? (
                  <img src={group.icon} alt={group.group} className="h-8 w-8" />
                ) : (
                  <Ticket className="h-8 w-8 text-accent" />
                )}
                <span className="text-center text-sm font-medium">{group.group}</span>
              </Card.Content>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <Card.Content className="py-12 text-center">
            <Ticket className="mx-auto mb-3 h-12 w-12 text-muted" />
            <p className="text-muted">{id.ppob.noProducts}</p>
          </Card.Content>
        </Card>
      )}
    </div>
  )
}

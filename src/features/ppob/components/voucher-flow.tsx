import { useNavigate } from "react-router-dom"
import { Card, Skeleton } from "@heroui/react"
import { Ticket } from "lucide-react"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { NoData } from "@/components/no-data"
import { id } from "@/i18n/id"
import { PPOB_SERVICE_COLORS } from "../constants"
import { useVoucherGroups } from "../hooks"

export function VoucherFlow() {
  const navigate = useNavigate()

  const { data: groups, isLoading } = useVoucherGroups()

  return (
    <div className="flex flex-col gap-6">
      <SubpageHeader title={id.ppob.voucher} onBack={() => navigate("/ppob")} />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : groups && groups.length > 0 ? (
        // Belum ada aksi di balik grup voucher, jadi kartunya diam.
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {groups.map((group) => (
            <Card key={group.id}>
              <Card.Content className="items-center justify-center gap-2 text-center">
                {group.icon ? (
                  <img src={group.icon} alt="" className="size-8" />
                ) : (
                  <Ticket
                    aria-hidden="true"
                    className={`size-8 ${PPOB_SERVICE_COLORS.voucher.text}`}
                  />
                )}
                <Card.Title>{group.group}</Card.Title>
              </Card.Content>
            </Card>
          ))}
        </div>
      ) : (
        <NoData icon={<Ticket />} title={id.ppob.noProducts} />
      )}
    </div>
  )
}

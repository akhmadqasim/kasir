import { useNavigate } from "react-router-dom"
import { Alert, Card, Skeleton } from "@heroui/react"
import { Ticket } from "lucide-react"

import { CardHeading } from "@/components/card-heading"
import { SubpageHeader } from "@/components/layout/subpage-header"
import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { id } from "@/i18n/id"
import { PPOB_SERVICE_COLORS } from "../constants"
import { useVoucherGroups } from "../hooks"
import { PaymentPointIcon } from "./payment-point-icon"
import { PpobSetupAction } from "./ppob-setup-action"

const GRID_CLASS = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"

export function VoucherFlow() {
  const navigate = useNavigate()

  const { data: groups, isLoading, isFetching, error, refetch } = useVoucherGroups()

  return (
    <div className="flex flex-col gap-6">
      <SubpageHeader title={id.ppob.voucher} onBack={() => navigate("/ppob")} />

      {isLoading ? (
        <div className={GRID_CLASS}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : error ? (
        <LoadError
          isRetrying={isFetching}
          secondaryAction={<PpobSetupAction error={error} />}
          title={id.loadFailed.ppobVouchers}
          onRetry={() => refetch()}
        >
          {error.message}
        </LoadError>
      ) : groups && groups.length > 0 ? (
        <>
          {/* Kartunya diam — pembelian voucher belum tersambung. Tanpa kalimat
              ini kasir menekan kartu dan mengira aplikasinya macet. */}
          <Alert>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Pembelian voucher belum tersedia</Alert.Title>
              <Alert.Description>
                Daftar ini hanya menampilkan grup voucher yang ada di Mitra.
              </Alert.Description>
            </Alert.Content>
          </Alert>
          <ul aria-label="Grup voucher" className={GRID_CLASS}>
            {groups.map((group) => (
              <li key={group.id} className="contents">
                <Card>
                  <Card.Content className="items-center justify-center gap-2 text-center">
                    <span
                      aria-hidden="true"
                      className={`flex size-11 items-center justify-center rounded-full ${PPOB_SERVICE_COLORS.voucher.bgMuted}`}
                    >
                      <PaymentPointIcon
                        className="size-6"
                        fallback={Ticket}
                        fallbackClassName={PPOB_SERVICE_COLORS.voucher.text}
                        pathIcon={group.icon}
                      />
                    </span>
                    <CardHeading>{group.group}</CardHeading>
                  </Card.Content>
                </Card>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <NoData icon={<Ticket />} title={id.ppob.noProducts} />
      )}
    </div>
  )
}

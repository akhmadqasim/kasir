import type { ReactNode } from "react"
import { Card } from "@heroui/react"
import { RefreshCw } from "lucide-react"

import { CardHeading } from "@/components/card-heading"
import { LoadError } from "@/components/load-error"
import { PendingButton } from "@/components/pending-button"
import { SummaryList, type SummaryItem } from "@/components/summary-list"
import { useAuthStore } from "@/features/auth"
import { id as t } from "@/i18n/id"
import { formatDateTime } from "@/lib/format"
import { useInstallConfirmation } from "../hooks/use-install-confirmation"
import { isBusyPhase, useUpdateActions, useUpdateStatus } from "../hooks/use-update-status"
import { describeStatus, isVisibleFailure } from "../lib/describe-status"
import { InstallUpdateDialog } from "./install-update-dialog"
import { UpdateProgress } from "./update-progress"

/**
 * Pengaturan → Aplikasi: the installed version, the updater's status, and the
 * button to ask now instead of waiting for the background check.
 *
 * Any user may look and may check — knowing a newer version exists is how a
 * cashier tells the owner. Only an admin gets the buttons that download and
 * install, matching the admin-only routes behind them.
 */
export function AppUpdateCard() {
  const isAdmin = useAuthStore((s) => s.user?.role === "admin")
  const statusQuery = useUpdateStatus()
  const { data: status } = statusQuery
  const { check, download, install } = useUpdateActions()
  const confirmation = useInstallConfirmation(install)

  const statusText = status ? describeStatus(status) : "—"
  // Unlike the banner, this card is where a person asks, so a failed check is
  // shown here too — as red text that still says what went wrong in words.
  const statusTone: SummaryItem["tone"] = status?.phase === "failed" ? "danger" : "default"

  const items: SummaryItem[] = [
    { label: t.updater.installedVersion, value: status?.current_version ?? "—", tone: "mono" },
    { label: t.updater.status, value: statusText, tone: statusTone },
  ]
  if (status?.phase === "available" && status.published_at) {
    items.push({ label: t.updater.publishedAt, value: formatDateTime(status.published_at) })
  }

  // One primary per card: whichever step is next. "Periksa" stays secondary
  // because it never changes anything on the till.
  let primary: ReactNode = null
  if (isAdmin && status) {
    if (status.phase === "available" || isVisibleFailure(status)) {
      primary = (
        <PendingButton isPending={download.isPending} onPress={() => download.mutate()}>
          {status.phase === "available" ? t.updater.updateNow : t.common.retry}
        </PendingButton>
      )
    } else if (status.phase === "ready") {
      primary = (
        <PendingButton
          isPending={install.isPending}
          onPress={() => confirmation.request(status.version)}
        >
          {t.updater.restartToFinish}
        </PendingButton>
      )
    }
  }

  return (
    <Card>
      <Card.Header>
        <CardHeading>{t.settings.tabApp}</CardHeading>
        <Card.Description>
          Database toko disimpan terpisah, jadi memasang versi baru tidak menghapus data.
        </Card.Description>
      </Card.Header>
      <Card.Content className="gap-4">
        {statusQuery.isError && !status ? (
          <LoadError
            isRetrying={statusQuery.isFetching}
            title={t.loadFailed.updateStatus}
            onRetry={() => void statusQuery.refetch()}
          >
            {statusQuery.error.message}
          </LoadError>
        ) : (
          <SummaryList items={items} layout="grid" />
        )}

        {status?.phase === "available" && status.notes && (
          <div className="flex flex-col gap-1 text-sm">
            <p className="text-muted">{t.updater.notes}</p>
            <p className="whitespace-pre-line text-foreground">{status.notes}</p>
          </div>
        )}
        {status?.phase === "available" && !isAdmin && (
          <p className="text-sm text-muted">{t.updater.askAdmin}</p>
        )}
        {status?.phase === "downloading" && (
          <UpdateProgress
            received={status.received}
            total={status.total}
            version={status.version}
          />
        )}
      </Card.Content>
      <Card.Footer className="flex-wrap gap-2">
        {primary}
        {/* The label stays put (PendingButton, DESIGN.md §5.6): the spinner and
            the status row already say "Memeriksa…", and a label that grew
            longer shifted the primary button beside it. */}
        <PendingButton
          isDisabled={isBusyPhase(status?.phase)}
          isPending={check.isPending || status?.phase === "checking"}
          variant="secondary"
          onPress={() => check.mutate()}
        >
          <RefreshCw />
          {t.updater.checkNow}
        </PendingButton>
      </Card.Footer>

      <InstallUpdateDialog {...confirmation.dialogProps} />
    </Card>
  )
}

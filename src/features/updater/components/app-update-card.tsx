import { useState, type ReactNode } from "react"
import { Card } from "@heroui/react"
import { RefreshCw } from "lucide-react"

import { PendingButton } from "@/components/pending-button"
import { SummaryList, type SummaryItem } from "@/components/summary-list"
import { useAuthStore } from "@/features/auth"
import { id as t } from "@/i18n/id"
import { formatDateTime } from "@/lib/format"
import { toast } from "@/lib/toast"
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
  const { data: status } = useUpdateStatus()
  const { check, download, install } = useUpdateActions()
  const [confirmVersion, setConfirmVersion] = useState<string | null>(null)

  const runCheck = () => check.mutate(undefined, { onError: (error) => toast.error(error.message) })
  const confirmInstall = () => {
    setConfirmVersion(null)
    install.mutate()
  }

  const statusText = status ? describeStatus(status) : "—"
  const statusTone: SummaryItem["tone"] = isVisibleFailure(status) ? "danger" : "default"

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
          {status.phase === "available" ? t.updater.updateNow : t.updater.retry}
        </PendingButton>
      )
    } else if (status.phase === "ready") {
      primary = (
        <PendingButton
          isPending={install.isPending}
          onPress={() => setConfirmVersion(status.version)}
        >
          {t.updater.restartToFinish}
        </PendingButton>
      )
    }
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>{t.settings.tabApp}</Card.Title>
      </Card.Header>
      <Card.Content className="gap-4">
        <SummaryList items={items} layout="grid" />

        {status?.phase === "available" && status.notes && (
          <div className="text-sm">
            <p className="text-muted">{t.updater.notes}</p>
            <p className="whitespace-pre-line">{status.notes}</p>
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
      <Card.Footer className="gap-2">
        {primary}
        <PendingButton
          isDisabled={isBusyPhase(status?.phase)}
          isPending={check.isPending}
          variant="secondary"
          onPress={runCheck}
        >
          <RefreshCw />
          {t.updater.checkNow}
        </PendingButton>
      </Card.Footer>

      <InstallUpdateDialog
        version={confirmVersion}
        onClose={() => setConfirmVersion(null)}
        onConfirm={confirmInstall}
      />
    </Card>
  )
}

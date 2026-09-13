import { useState, type ReactNode } from "react"
import { Alert, Button, Spinner } from "@heroui/react"

import { PendingButton } from "@/components/pending-button"
import { useAuthStore } from "@/features/auth"
import { id as t } from "@/i18n/id"
import { useUpdateActions, useUpdateStatus } from "../hooks/use-update-status"
import { isVisibleFailure, pendingVersion } from "../lib/describe-status"
import { InstallUpdateDialog } from "./install-update-dialog"
import { UpdateProgress } from "./update-progress"

/**
 * The strip above every screen while an update is in play.
 *
 * Admins only: they are the ones who can download and install, and a cashier
 * who cannot act on the banner would only be told to fetch someone. A silent
 * background check that finds nothing renders nothing — no toast, no empty
 * strip — and a check that *failed* silently stays silent too; only failures
 * of something a person started are shown.
 *
 * "Nanti" hides the current version for this session. It comes back on the
 * next launch, which is the next natural moment to ask.
 */
export function UpdateBanner() {
  const isAdmin = useAuthStore((s) => s.user?.role === "admin")
  const { data: status } = useUpdateStatus()
  const { download, install } = useUpdateActions()
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  const [confirmVersion, setConfirmVersion] = useState<string | null>(null)

  if (!isAdmin || !status) return null

  const version = pendingVersion(status)
  const isDismissed =
    version !== null &&
    version === dismissedVersion &&
    (status.phase === "available" || status.phase === "ready")

  if (isDismissed) return null

  const dismiss = () => setDismissedVersion(version)
  const confirmInstall = () => {
    setConfirmVersion(null)
    install.mutate()
  }

  let alert: ReactNode = null

  switch (status.phase) {
    case "available":
      alert = (
        <Alert status="accent">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t.updater.available(status.version)}</Alert.Title>
            <Alert.Description>{t.updater.availableHint}</Alert.Description>
            <div className="mt-2 flex flex-wrap gap-2">
              <PendingButton
                isPending={download.isPending}
                size="sm"
                onPress={() => download.mutate()}
              >
                {t.updater.updateNow}
              </PendingButton>
              <Button size="sm" variant="tertiary" onPress={dismiss}>
                {t.updater.later}
              </Button>
            </div>
          </Alert.Content>
        </Alert>
      )
      break

    case "downloading":
      alert = (
        <Alert status="accent">
          <Alert.Indicator>
            <Spinner size="sm" />
          </Alert.Indicator>
          <Alert.Content>
            <UpdateProgress
              received={status.received}
              total={status.total}
              version={status.version}
            />
          </Alert.Content>
        </Alert>
      )
      break

    case "ready":
      alert = (
        <Alert status="success">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t.updater.ready(status.version)}</Alert.Title>
            <Alert.Description>{t.updater.readyHint}</Alert.Description>
            <div className="mt-2 flex flex-wrap gap-2">
              <PendingButton
                isPending={install.isPending}
                size="sm"
                onPress={() => setConfirmVersion(status.version)}
              >
                {t.updater.restartToFinish}
              </PendingButton>
              <Button size="sm" variant="tertiary" onPress={dismiss}>
                {t.updater.later}
              </Button>
            </div>
          </Alert.Content>
        </Alert>
      )
      break

    case "installing":
      alert = (
        <Alert status="accent">
          <Alert.Indicator>
            <Spinner size="sm" />
          </Alert.Indicator>
          <Alert.Content>
            <Alert.Title>{t.updater.installing(status.version)}</Alert.Title>
            <Alert.Description>{t.updater.installingHint}</Alert.Description>
          </Alert.Content>
        </Alert>
      )
      break

    case "failed":
      if (!isVisibleFailure(status)) break
      alert = (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t.updater.failedTitle}</Alert.Title>
            <Alert.Description>{status.message}</Alert.Description>
            <div className="mt-2 flex flex-wrap gap-2">
              {/* A failed install has thrown its bytes away; the server still
                  remembers the release, so retrying is a fresh download. */}
              <PendingButton
                isPending={download.isPending}
                size="sm"
                variant="secondary"
                onPress={() => download.mutate()}
              >
                {t.updater.retry}
              </PendingButton>
            </div>
          </Alert.Content>
        </Alert>
      )
      break

    default:
      break
  }

  if (alert === null) return null

  return (
    <>
      {alert}
      <InstallUpdateDialog
        version={confirmVersion}
        onClose={() => setConfirmVersion(null)}
        onConfirm={confirmInstall}
      />
    </>
  )
}

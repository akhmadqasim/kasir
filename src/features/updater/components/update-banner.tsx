import { useState, type ReactNode } from "react"
import { Alert, Button, Spinner } from "@heroui/react"

import { PendingButton } from "@/components/pending-button"
import { useAuthStore } from "@/features/auth"
import { id as t } from "@/i18n/id"
import { useInstallConfirmation } from "../hooks/use-install-confirmation"
import { useUpdateActions, useUpdateStatus } from "../hooks/use-update-status"
import { isVisibleFailure } from "../lib/describe-status"
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
 * "Nanti" hides that one offer — the phase and the version — for this session.
 * Putting off the download does not put off the later "mulai ulang", and
 * everything comes back on the next launch, the next natural moment to ask.
 */
export function UpdateBanner() {
  const isAdmin = useAuthStore((s) => s.user?.role === "admin")
  const { data: status } = useUpdateStatus()
  const { download, install } = useUpdateActions()
  const confirmation = useInstallConfirmation(install)
  const [dismissed, setDismissed] = useState<string | null>(null)

  if (!isAdmin || !status) return null

  // Only the two phases that wait on a person can be put off; a download or
  // an install in progress is shown regardless.
  const offer =
    status.phase === "available" || status.phase === "ready"
      ? `${status.phase}:${status.version}`
      : null
  if (offer !== null && offer === dismissed) return null

  const dismiss = () => setDismissed(offer)

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
                onPress={() => confirmation.request(status.version)}
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

  // `print:hidden`: the layout prints its content pane for the shift report,
  // and an update offer is not part of that document.
  return (
    <div className="print:hidden">
      {alert}
      <InstallUpdateDialog {...confirmation.dialogProps} />
    </div>
  )
}

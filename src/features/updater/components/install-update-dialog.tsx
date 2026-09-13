import { AlertDialog, Button } from "@heroui/react"

import { id as t } from "@/i18n/id"

interface InstallUpdateDialogProps {
  /** The version about to be installed; `null` closes the dialog. */
  version: string | null
  onClose: () => void
  onConfirm: () => void
}

/**
 * The one question before the app closes itself.
 *
 * Installing is not destructive to data — the database lives outside the
 * program folder — but it does end whatever is on screen, and a till mid-sale
 * is the wrong moment. `AlertDialog` because the decision has to be explicit;
 * `warning` rather than `danger` because nothing is lost, only interrupted.
 */
export function InstallUpdateDialog({ version, onClose, onConfirm }: InstallUpdateDialogProps) {
  return (
    <AlertDialog.Backdrop
      isKeyboardDismissDisabled={false}
      isOpen={version !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <AlertDialog.Container size="sm">
        <AlertDialog.Dialog aria-label={t.updater.confirmTitle}>
          <AlertDialog.Header>
            <AlertDialog.Icon status="warning" />
            <AlertDialog.Heading>{t.updater.confirmTitle}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>{t.updater.confirmBody(version ?? "")}</p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary">
              {t.common.cancel}
            </Button>
            <Button onPress={onConfirm}>{t.updater.confirmInstall}</Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

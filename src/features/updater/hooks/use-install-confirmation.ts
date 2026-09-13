import { useState } from "react"
import type { UseMutationResult } from "@tanstack/react-query"

import type { ApiError } from "@/lib/api/client"
import type { InstallUpdateDialogProps } from "../components/install-update-dialog"
import type { UpdateStatus } from "../types"

/**
 * The "ask once, then install" step, shared by the banner and the settings
 * card so neither owns its own copy of the pending-version state.
 *
 * `request(version)` opens the dialog; `dialogProps` go straight onto an
 * `InstallUpdateDialog`, whose confirm runs the mutation that was passed in.
 */
export function useInstallConfirmation(install: UseMutationResult<UpdateStatus, ApiError, void>) {
  const [version, setVersion] = useState<string | null>(null)
  const close = () => setVersion(null)

  const dialogProps: InstallUpdateDialogProps = {
    version,
    onClose: close,
    onConfirm: () => {
      close()
      install.mutate()
    },
  }

  return { request: setVersion, dialogProps }
}

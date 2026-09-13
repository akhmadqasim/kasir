import { Label, ProgressBar } from "@heroui/react"

import { id as t } from "@/i18n/id"
import { formatFileSize } from "@/lib/format"

interface UpdateProgressProps {
  version: string
  received: number
  /** `Content-Length`, or `null` when GitHub did not send one. */
  total: number | null
}

/**
 * Download progress, determinate when the size is known.
 *
 * Follows the "Custom Value" ProgressBar example: the bytes are the value and
 * the output is the formatted text, so the bar and the number cannot disagree.
 */
export function UpdateProgress({ version, received, total }: UpdateProgressProps) {
  const valueText =
    total === null
      ? formatFileSize(received)
      : `${formatFileSize(received)} / ${formatFileSize(total)}`

  return (
    <ProgressBar
      aria-label={t.updater.downloading(version)}
      className="w-full"
      isIndeterminate={total === null}
      maxValue={total ?? undefined}
      size="sm"
      value={total === null ? undefined : received}
      valueLabel={valueText}
    >
      <Label>{t.updater.downloading(version)}</Label>
      <ProgressBar.Output />
      <ProgressBar.Track>
        <ProgressBar.Fill />
      </ProgressBar.Track>
    </ProgressBar>
  )
}

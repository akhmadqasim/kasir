import { CreditCard } from "lucide-react"

import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { id } from "@/i18n/id"
import type { PpobMenuGroup } from "../../types"
import { PaymentPointIcon } from "../payment-point-icon"
import { TileButton } from "../tile-button"
import { TileGrid, TileGridSkeleton } from "../tile-grid"
import { PpobSetupAction } from "../ppob-setup-action"

interface PpGroupStepProps {
  groups: PpobMenuGroup[] | undefined
  isLoading: boolean
  error: Error | null
  onRetry: () => void
  /** `true` selama permintaan ulang berjalan. */
  isRetrying?: boolean
  onSelect: (group: PpobMenuGroup) => void
}

/** Langkah 1 Payment Point: kategori biller sebagai kisi ubin. */
export function PpGroupStep({
  groups,
  isLoading,
  error,
  onRetry,
  isRetrying = false,
  onSelect,
}: PpGroupStepProps) {
  if (isLoading) return <TileGridSkeleton count={9} />

  if (error) {
    return (
      <LoadError
        isRetrying={isRetrying}
        secondaryAction={<PpobSetupAction error={error} />}
        title={id.loadFailed.ppobGroups}
        onRetry={onRetry}
      >
        {error.message}
      </LoadError>
    )
  }

  if (groups && groups.length === 0) {
    return <NoData icon={<CreditCard />} title={id.empty.ppobGroups} />
  }

  return (
    <TileGrid>
      {groups?.map((group) => (
        <TileButton
          key={group.id}
          icon={<PaymentPointIcon className="size-8" pathIcon={group.pathIcon} />}
          label={group.group}
          onPress={() => onSelect(group)}
        />
      ))}
    </TileGrid>
  )
}
